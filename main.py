#!/usr/bin/env python3
"""
Eye tracking application using OpenCV and MediaPipe.
Runs directly when executed.
"""

import cv2
import mediapipe as mp
import numpy as np
import sys


class EyeTracker:
    """Eye tracking using MediaPipe Face Mesh."""
    
    def __init__(self):
        self.mp_face_mesh = mp.solutions.face_mesh
        self.face_mesh = self.mp_face_mesh.FaceMesh(
            max_num_faces=1,
            refine_landmarks=True,
            min_detection_confidence=0.5,
            min_tracking_confidence=0.5
        )
        self.mp_drawing = mp.solutions.drawing_utils
        self.mp_drawing_styles = mp.solutions.drawing_styles
        
        # Eye landmark indices (left and right eye)
        # MediaPipe Face Mesh has 468 landmarks
        self.LEFT_EYE_INDICES = [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246]
        self.RIGHT_EYE_INDICES = [362, 382, 381, 380, 374, 373, 390, 249, 263, 466, 388, 387, 386, 385, 384, 398]
        
        # Iris landmarks (left and right)
        self.LEFT_IRIS_INDICES = [474, 475, 476, 477]
        self.RIGHT_IRIS_INDICES = [469, 470, 471, 472]
        
    def get_eye_center(self, landmarks, eye_indices):
        """Calculate the center point of an eye."""
        eye_points = [landmarks[idx] for idx in eye_indices]
        x_coords = [point.x for point in eye_points]
        y_coords = [point.y for point in eye_points]
        return np.mean(x_coords), np.mean(y_coords)
    
    def get_iris_center(self, landmarks, iris_indices):
        """Calculate the center point of an iris."""
        iris_points = [landmarks[idx] for idx in iris_indices]
        x_coords = [point.x for point in iris_points]
        y_coords = [point.y for point in iris_points]
        return np.mean(x_coords), np.mean(y_coords)
    
    def calculate_gaze_direction(self, eye_center, iris_center):
        """Calculate gaze direction vector."""
        dx = iris_center[0] - eye_center[0]
        dy = iris_center[1] - eye_center[1]
        return dx, dy
    
    def get_face_bbox(self, landmarks, h, w):
        """Calculate bounding box around the face."""
        x_coords = [landmark.x * w for landmark in landmarks]
        y_coords = [landmark.y * h for landmark in landmarks]
        
        x_min = int(min(x_coords))
        x_max = int(max(x_coords))
        y_min = int(min(y_coords))
        y_max = int(max(y_coords))
        
        # Add some padding
        padding = 20
        x_min = max(0, x_min - padding)
        y_min = max(0, y_min - padding)
        x_max = min(w, x_max + padding)
        y_max = min(h, y_max + padding)
        
        return x_min, y_min, x_max, y_max
    
    def process_frame(self, frame):
        """Process a single frame and return gaze information."""
        rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        results = self.face_mesh.process(rgb_frame)
        
        h, w = frame.shape[:2]
        gaze_data = None
        
        if results.multi_face_landmarks:
            face_landmarks = results.multi_face_landmarks[0]
            landmarks = face_landmarks.landmark
            
            # Get face bounding box and draw green box
            x_min, y_min, x_max, y_max = self.get_face_bbox(landmarks, h, w)
            cv2.rectangle(frame, (x_min, y_min), (x_max, y_max), (0, 255, 0), 3)
            
            # Draw "EYES TRACKED" label
            label = "EYES TRACKED"
            label_size = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.7, 2)[0]
            label_x = x_min
            label_y = y_min - 10 if y_min > 30 else y_max + 30
            cv2.rectangle(frame, (label_x, label_y - label_size[1] - 5), 
                         (label_x + label_size[0] + 10, label_y + 5), (0, 255, 0), -1)
            cv2.putText(frame, label, (label_x + 5, label_y), 
                       cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 0), 2)
            
            # Get eye centers
            left_eye_center = self.get_eye_center(landmarks, self.LEFT_EYE_INDICES)
            right_eye_center = self.get_eye_center(landmarks, self.RIGHT_EYE_INDICES)
            
            # Get iris centers
            left_iris_center = self.get_iris_center(landmarks, self.LEFT_IRIS_INDICES)
            right_iris_center = self.get_iris_center(landmarks, self.RIGHT_IRIS_INDICES)
            
            # Calculate gaze directions
            left_gaze = self.calculate_gaze_direction(left_eye_center, left_iris_center)
            right_gaze = self.calculate_gaze_direction(right_eye_center, right_iris_center)
            
            # Average gaze direction
            avg_gaze_x = (left_gaze[0] + right_gaze[0]) / 2
            avg_gaze_y = (left_gaze[1] + right_gaze[1]) / 2
            
            # Convert to pixel coordinates
            left_iris_px = (int(left_iris_center[0] * w), int(left_iris_center[1] * h))
            right_iris_px = (int(right_iris_center[0] * w), int(right_iris_center[1] * h))
            left_eye_px = (int(left_eye_center[0] * w), int(left_eye_center[1] * h))
            right_eye_px = (int(right_eye_center[0] * w), int(right_eye_center[1] * h))
            
            # Draw eye landmarks and iris
            for idx in self.LEFT_EYE_INDICES:
                pt = landmarks[idx]
                x, y = int(pt.x * w), int(pt.y * h)
                cv2.circle(frame, (x, y), 2, (0, 255, 0), -1)
            
            for idx in self.RIGHT_EYE_INDICES:
                pt = landmarks[idx]
                x, y = int(pt.x * w), int(pt.y * h)
                cv2.circle(frame, (x, y), 2, (0, 255, 0), -1)
            
            # Draw iris centers
            cv2.circle(frame, left_iris_px, 5, (0, 0, 255), -1)
            cv2.circle(frame, right_iris_px, 5, (0, 0, 255), -1)
            
            # Draw eye centers
            cv2.circle(frame, left_eye_px, 3, (255, 0, 0), -1)
            cv2.circle(frame, right_eye_px, 3, (255, 0, 0), -1)
            
            # Draw gaze vectors
            gaze_scale = 100
            left_gaze_end = (left_iris_px[0] + int(left_gaze[0] * gaze_scale * w), 
                           left_iris_px[1] + int(left_gaze[1] * gaze_scale * h))
            right_gaze_end = (right_iris_px[0] + int(right_gaze[0] * gaze_scale * w), 
                            right_iris_px[1] + int(right_gaze[1] * gaze_scale * h))
            
            cv2.arrowedLine(frame, left_iris_px, left_gaze_end, (255, 255, 0), 2)
            cv2.arrowedLine(frame, right_iris_px, right_gaze_end, (255, 255, 0), 2)
            
            gaze_data = {
                'left_iris': left_iris_px,
                'right_iris': right_iris_px,
                'gaze_x': avg_gaze_x,
                'gaze_y': avg_gaze_y,
                'left_gaze': left_gaze,
                'right_gaze': right_gaze
            }
        
        return frame, gaze_data


def main():
    """Main function to run eye tracking."""
    print("Starting Orbitalis - Eye Tracking...")
    print("Press 'q' to quit")
    
    # Initialize camera
    cap = cv2.VideoCapture(0)
    if not cap.isOpened():
        print("Error: Could not open camera")
        sys.exit(1)
    
    # Set camera resolution
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
    
    # Initialize eye tracker
    tracker = EyeTracker()
    
    frame_count = 0
    
    try:
        while True:
            ret, frame = cap.read()
            if not ret:
                print("Error: Failed to capture frame")
                break
            
            # Flip frame horizontally for mirror effect
            frame = cv2.flip(frame, 1)
            
            # Process frame
            processed_frame, gaze_data = tracker.process_frame(frame)
            
            # Display gaze information
            if gaze_data:
                info_text = [
                    f"Status: TRACKING",  # Green status when tracking
                    f"Left Iris: {gaze_data['left_iris']}",
                    f"Right Iris: {gaze_data['right_iris']}",
                    f"Gaze X: {gaze_data['gaze_x']:.4f}",
                    f"Gaze Y: {gaze_data['gaze_y']:.4f}"
                ]
                
                y_offset = 30
                # Draw status in green
                cv2.putText(processed_frame, "Status: TRACKING", (10, y_offset),
                          cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 2)
                
                # Draw other info
                for i, text in enumerate(info_text[1:], 1):
                    cv2.putText(processed_frame, text, (10, y_offset + i * 25),
                              cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)
                    cv2.putText(processed_frame, text, (10, y_offset + i * 25),
                              cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 0), 1)
            else:
                cv2.putText(processed_frame, "Status: NO FACE DETECTED", (10, 30),
                          cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 255), 2)
            
            # Display frame
            cv2.imshow('Orbitalis - Eye Tracking', processed_frame)
            
            # Print gaze data every 30 frames (approximately once per second)
            frame_count += 1
            if frame_count % 30 == 0 and gaze_data:
                print(f"Gaze - X: {gaze_data['gaze_x']:.4f}, Y: {gaze_data['gaze_y']:.4f} | "
                      f"Left Iris: {gaze_data['left_iris']}, Right Iris: {gaze_data['right_iris']}")
            
            # Exit on 'q' key press
            if cv2.waitKey(1) & 0xFF == ord('q'):
                break
                
    except KeyboardInterrupt:
        print("\nStopping Orbitalis...")
    finally:
        cap.release()
        cv2.destroyAllWindows()
        print("Orbitalis stopped.")


if __name__ == "__main__":
    main()
