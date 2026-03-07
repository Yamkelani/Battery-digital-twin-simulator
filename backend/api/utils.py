"""
Shared Utilities for the API layer
=====================================

JSON serialization helpers used by both REST routes and WebSocket handlers.
"""

import math
import numpy as np
from typing import Any


def sanitize_float(v: Any) -> Any:
    """Replace NaN / Inf with JSON-safe ``None``."""
    if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
        return None
    return v


def convert_numpy(obj: Any) -> Any:
    """Recursively convert numpy types to native Python types for JSON serialization.

    Also sanitises NaN / Inf which produce non-standard JSON tokens that
    JavaScript's ``JSON.parse()`` rejects.
    """
    if isinstance(obj, dict):
        return {k: convert_numpy(v) for k, v in obj.items()}
    elif isinstance(obj, (list, tuple)):
        return [convert_numpy(item) for item in obj]
    elif isinstance(obj, np.ndarray):
        cleaned = np.where(np.isfinite(obj), obj, 0.0)
        return cleaned.tolist()
    elif isinstance(obj, (np.integer,)):
        return int(obj)
    elif isinstance(obj, (np.floating,)):
        return sanitize_float(float(obj))
    elif isinstance(obj, np.bool_):
        return bool(obj)
    elif isinstance(obj, float):
        return sanitize_float(obj)
    return obj


def deep_sanitize(obj: Any) -> Any:
    """Final safety pass — replace any remaining Python float NaN/Inf."""
    if isinstance(obj, dict):
        return {k: deep_sanitize(v) for k, v in obj.items()}
    elif isinstance(obj, (list, tuple)):
        return [deep_sanitize(i) for i in obj]
    elif isinstance(obj, float) and (math.isnan(obj) or math.isinf(obj)):
        return None
    return obj
