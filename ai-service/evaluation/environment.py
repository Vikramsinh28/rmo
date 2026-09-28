from __future__ import annotations

import os
import platform
import shutil
import subprocess
from typing import Any, Dict


def detect_environment() -> Dict[str, Any]:
    """Report runtime environment. Does not require GPU packages."""
    mem_total_mb = None
    try:
        page_size = os.sysconf('SC_PAGE_SIZE')
        phys_pages = os.sysconf('SC_PHYS_PAGES')
        mem_total_mb = round((page_size * phys_pages) / (1024 * 1024), 1)
    except (ValueError, OSError, AttributeError):
        mem_total_mb = None

    cuda_available = False
    torch_version = None
    try:
        import torch  # type: ignore

        torch_version = getattr(torch, '__version__', None)
        cuda_available = bool(torch.cuda.is_available())
    except Exception:
        pass

    gpu_name = None
    if shutil.which('nvidia-smi'):
        try:
            out = subprocess.check_output(
                ['nvidia-smi', '--query-gpu=name', '--format=csv,noheader'],
                stderr=subprocess.DEVNULL,
                text=True,
                timeout=2,
            ).strip()
            gpu_name = out.splitlines()[0] if out else None
        except Exception:
            gpu_name = None

    return {
        'pythonVersion': platform.python_version(),
        'platform': platform.platform(),
        'processor': platform.processor() or platform.machine(),
        'cpuCount': os.cpu_count(),
        'ramTotalMb': mem_total_mb,
        'cudaAvailable': cuda_available,
        'torchVersion': torch_version,
        'gpuName': gpu_name,
        'deviceConfigured': os.environ.get('IMPAIRMENT_MODEL_DEVICE', 'cpu'),
    }
