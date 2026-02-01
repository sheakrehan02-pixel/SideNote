# Orbitalis - Eye Tracking

A real-time eye tracking application using OpenCV and MediaPipe that runs directly from Python.

## Features

- Real-time eye tracking using MediaPipe Face Mesh
- Iris and gaze direction detection
- Visual feedback with landmarks and gaze vectors
- Direct Python execution (no web browser required)

## Setup

1. Install dependencies:
```bash
pip install -r requirements.txt
```

2. Run the application:
```bash
python main.py
```

## Usage

1. **Run the script**: Execute `python main.py`
2. **Camera access**: The application will access your webcam automatically
3. **Position yourself**: Make sure your face is well-lit and visible to the camera
4. **View tracking**: The window will show:
   - Green dots: Eye landmarks
   - Red dots: Iris centers
   - Blue dots: Eye centers
   - Yellow arrows: Gaze direction vectors
   - Text overlay: Gaze coordinates and iris positions
5. **Exit**: Press 'q' key to quit

## Requirements

- Python 3.7+
- Webcam/camera access
- OpenCV
- MediaPipe
- NumPy

## Notes

- Make sure you're in a well-lit environment for better tracking accuracy
- Keep your face visible to the camera (within 1-2 feet)
- The application displays gaze data both visually and in the console

