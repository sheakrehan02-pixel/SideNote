#!/usr/bin/env python3
"""
Side Note — Eye tracking + cheating detection for online exams.
Uses gaze direction, hand position, and face position to flag suspicious behavior.
"""

import cv2
import mediapipe as mp
import numpy as np
import sys
from collections import deque

# --- Constants for cheating detection ---
GAZE_DOWN_THRESHOLD = 0.02   # iris below eye center (normalized) = looking down
GAZE_OFF_SCREEN_THRESHOLD = 0.08  # gaze too far left/right
LAP_ZONE_Y = 0.55            # hands below this Y (normalized) = in lap zone
HAND_NEAR_FACE_Y = 0.45      # hand above this = visible on camera (not in lap)
SUSPICIOUS_FRAMES_NEEDED = 15   # ~0.5 sec at 30fps before flagging
WARNING_FRAMES_NEEDED = 8       # fewer frames for warning


class EyeTracker:
    """Eye tracking using MediaPipe Face Mesh."""

    def __init__(self):
        self.mp_face_mesh = mp.solutions.face_mesh
        self.face_mesh = self.mp_face_mesh.FaceMesh(
            max_num_faces=1,
            refine_landmarks=True,
            min_detection_confidence=0.5,
            min_tracking_confidence=0.5,
        )
        self.LEFT_EYE_INDICES = [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246]
        self.RIGHT_EYE_INDICES = [362, 382, 381, 380, 374, 373, 390, 249, 263, 466, 388, 387, 386, 385, 384, 398]
        self.LEFT_IRIS_INDICES = [474, 475, 476, 477]
        self.RIGHT_IRIS_INDICES = [469, 470, 471, 472]

    def get_eye_center(self, landmarks, eye_indices):
        pts = [landmarks[i] for i in eye_indices]
        return np.mean([p.x for p in pts]), np.mean([p.y for p in pts])

    def get_iris_center(self, landmarks, iris_indices):
        pts = [landmarks[i] for i in iris_indices]
        return np.mean([p.x for p in pts]), np.mean([p.y for p in pts])

    def get_face_bbox(self, landmarks, h, w):
        xs = [lm.x * w for lm in landmarks]
        ys = [lm.y * h for lm in landmarks]
        pad = 20
        return (
            max(0, int(min(xs)) - pad),
            max(0, int(min(ys)) - pad),
            min(w, int(max(xs)) + pad),
            min(h, int(max(ys)) + pad),
        )

    def process_frame(self, frame):
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        results = self.face_mesh.process(rgb)
        h, w = frame.shape[:2]
        gaze_data = None

        if results.multi_face_landmarks:
            lm = results.multi_face_landmarks[0].landmark
            x_min, y_min, x_max, y_max = self.get_face_bbox(lm, h, w)
            cv2.rectangle(frame, (x_min, y_min), (x_max, y_max), (0, 255, 0), 2)

            left_eye = self.get_eye_center(lm, self.LEFT_EYE_INDICES)
            right_eye = self.get_eye_center(lm, self.RIGHT_EYE_INDICES)
            left_iris = self.get_iris_center(lm, self.LEFT_IRIS_INDICES)
            right_iris = self.get_iris_center(lm, self.RIGHT_IRIS_INDICES)

            left_gaze = (left_iris[0] - left_eye[0], left_iris[1] - left_eye[1])
            right_gaze = (right_iris[0] - right_eye[0], right_iris[1] - right_eye[1])
            gaze_x = (left_gaze[0] + right_gaze[0]) / 2
            gaze_y = (left_gaze[1] + right_gaze[1]) / 2

            # Face center (nose-ish) for "looking down" vs "face tilted"
            face_center_y = np.mean([p.y for p in lm])
            gaze_data = {
                "gaze_x": gaze_x,
                "gaze_y": gaze_y,
                "face_center_y": face_center_y,
                "left_iris": (int(left_iris[0] * w), int(left_iris[1] * h)),
                "right_iris": (int(right_iris[0] * w), int(right_iris[1] * h)),
            }

            # Draw iris
            cv2.circle(frame, gaze_data["left_iris"], 5, (0, 0, 255), -1)
            cv2.circle(frame, gaze_data["right_iris"], 5, (0, 0, 255), -1)

        return frame, gaze_data


class HandDetector:
    """Hand landmarks using MediaPipe Hands."""

    def __init__(self):
        self.mp_hands = mp.solutions.hands
        self.hands = self.mp_hands.Hands(
            static_image_mode=False,
            max_num_hands=2,
            min_detection_confidence=0.5,
            min_tracking_confidence=0.5,
        )

    def process_frame(self, frame):
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        results = self.hands.process(rgb)
        hand_data = []
        h, w = frame.shape[:2]
        if results.multi_hand_landmarks:
            for hand_lm in results.multi_hand_landmarks:
                # Wrist = 0, middle finger MCP = 9
                wrist = hand_lm.landmark[0]
                hand_center_y = np.mean([p.y for p in hand_lm.landmark])
                hand_center_x = np.mean([p.x for p in hand_lm.landmark])
                hand_data.append({
                    "wrist_y": wrist.y,
                    "wrist_x": wrist.x,
                    "center_y": hand_center_y,
                    "center_x": hand_center_x,
                    "in_lap_zone": wrist.y > LAP_ZONE_Y,
                })
                # Draw landmarks
                for pt in hand_lm.landmark:
                    px, py = int(pt.x * w), int(pt.y * h)
                    cv2.circle(frame, (px, py), 3, (255, 200, 0), -1)
        return frame, hand_data


class CheatingDetector:
    """
    Flags suspicious behavior:
    - Looking down (gaze) → likely phone/notes in lap
    - Hands in lap zone while looking down → high suspicion
    - Gaze off-screen (left/right) for long → second device
    - No face detected → person left or turned away
    """

    def __init__(self):
        self.history = deque(maxlen=30)  # ~1 sec at 30fps

    def update(self, gaze_data, hand_data, face_visible):
        reasons = []
        # Normalized: origin top-left, y increases downward
        if not face_visible:
            reasons.append("face_not_visible")
            self.history.append(reasons)
            return self._evaluate(reasons)

        gaze_y = gaze_data["gaze_y"]
        gaze_x = gaze_data["gaze_x"]

        # Looking down (iris below eye center in image = positive dy)
        if gaze_y > GAZE_DOWN_THRESHOLD:
            reasons.append("looking_down")

        # Gaze far left or right (off screen)
        if abs(gaze_x) > GAZE_OFF_SCREEN_THRESHOLD:
            reasons.append("gaze_off_screen")

        # Hands in lap (bottom of frame)
        hands_in_lap = sum(1 for h in hand_data if h["in_lap_zone"])
        if hands_in_lap >= 1:
            reasons.append("hand_in_lap")
        if hands_in_lap >= 2:
            reasons.append("both_hands_lap")

        # High risk: looking down + at least one hand in lap (like holding phone)
        if "looking_down" in reasons and ("hand_in_lap" in reasons or "both_hands_lap" in reasons):
            reasons.append("phone_risk")

        self.history.append(reasons)
        status, display_reasons, color = self._evaluate(reasons)
        if status == "ok":
            display_reasons = []
        return status, display_reasons, color

    def _evaluate(self, reasons):
        if not reasons:
            return "ok", [], (0, 255, 0)

        # Count how many recent frames had each reason
        recent = list(self.history)[-SUSPICIOUS_FRAMES_NEEDED:]
        count_looking_down = sum(1 for r in recent if "looking_down" in r)
        count_phone_risk = sum(1 for r in recent if "phone_risk" in r)
        count_off_screen = sum(1 for r in recent if "gaze_off_screen" in r)
        count_hand_lap = sum(1 for r in recent if "hand_in_lap" in r or "both_hands_lap" in r)

        # Suspicious: sustained looking down + hands in lap
        if count_phone_risk >= SUSPICIOUS_FRAMES_NEEDED:
            return "suspicious", ["Looking down at lap + hands in lap (possible phone)"], (0, 0, 255)
        if count_looking_down >= SUSPICIOUS_FRAMES_NEEDED:
            return "suspicious", ["Sustained looking down (possible notes/phone)"], (0, 0, 255)
        if count_off_screen >= SUSPICIOUS_FRAMES_NEEDED:
            return "suspicious", ["Looking off-screen (possible second device)"], (0, 0, 255)

        # Warning: shorter duration or single signals
        if count_phone_risk >= WARNING_FRAMES_NEEDED or count_looking_down >= WARNING_FRAMES_NEEDED:
            return "warning", ["Brief look down / hands in lap"], (0, 165, 255)
        if count_hand_lap >= WARNING_FRAMES_NEEDED:
            return "warning", ["Hands in lap zone"], (0, 165, 255)
        if "face_not_visible" in reasons:
            return "warning", ["Face not visible"], (0, 165, 255)

        return "ok", [], (0, 255, 0)


def main():
    print("Side Note — Eye tracking + cheating detection")
    print("Press 'q' to quit")
    print("Rules: looking down = lap/phone risk; hands in lap = suspicious; gaze off-screen = second device")

    cap = cv2.VideoCapture(0)
    if not cap.isOpened():
        print("Error: Could not open camera")
        sys.exit(1)
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)

    eye_tracker = EyeTracker()
    hand_detector = HandDetector()
    cheating_detector = CheatingDetector()

    try:
        while True:
            ret, frame = cap.read()
            if not ret:
                break
            frame = cv2.flip(frame, 1)
            h, w = frame.shape[:2]

            # Run pipelines
            frame, gaze_data = eye_tracker.process_frame(frame)
            frame, hand_data = hand_detector.process_frame(frame)

            face_visible = gaze_data is not None
            if gaze_data is None:
                gaze_data = {}

            status, reasons, color = cheating_detector.update(gaze_data, hand_data, face_visible)

            # Status panel
            panel_h = 120
            cv2.rectangle(frame, (0, 0), (w, panel_h), (40, 40, 50), -1)
            cv2.rectangle(frame, (0, 0), (w, panel_h), (60, 60, 70), 1)

            status_text = f"Status: {status.upper()}"
            cv2.putText(frame, status_text, (12, 32), cv2.FONT_HERSHEY_SIMPLEX, 0.8, color, 2)
            if reasons:
                for i, r in enumerate(reasons[:3]):
                    cv2.putText(frame, f"  - {r}", (12, 58 + i * 22), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (200, 200, 200), 1)
            else:
                cv2.putText(frame, "  - Eyes on screen, posture OK", (12, 58), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (150, 255, 150), 1)

            # Lap zone line (visual guide)
            lap_y = int(LAP_ZONE_Y * h)
            cv2.line(frame, (0, lap_y), (w, lap_y), (80, 80, 80), 1)
            cv2.putText(frame, "lap zone below", (w - 140, lap_y - 6), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (100, 100, 100), 1)

            cv2.imshow("Side Note — Cheating Detection", frame)
            if cv2.waitKey(1) & 0xFF == ord("q"):
                break
    except KeyboardInterrupt:
        pass
    finally:
        cap.release()
        cv2.destroyAllWindows()
        print("Side Note stopped.")


if __name__ == "__main__":
    main()
