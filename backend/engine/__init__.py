"""ReCompute engine package and frozen model import setup."""
from pathlib import Path
import sys
MODEL_DIR = Path(__file__).resolve().parents[1] / "model"
if str(MODEL_DIR) not in sys.path:
    sys.path.insert(0, str(MODEL_DIR))
