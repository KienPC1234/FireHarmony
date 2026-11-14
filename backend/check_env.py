"""Check the ML environment: Python, CUDA, PyTorch, and key libraries."""
import sys


def main() -> int:
    print("=" * 55)
    print(f"Python : {sys.version.split()[0]}  ({sys.executable})")

    try:
        import torch
    except ImportError:
        print("[ERROR] torch is not installed. Run: pip install -r requirements.txt")
        return 1

    print(f"PyTorch: {torch.__version__}")
    print(f"CUDA build: {torch.version.cuda}")
    print(f"cuDNN  : {torch.backends.cudnn.version()}")
    print(f"CUDA available: {torch.cuda.is_available()}")

    if torch.cuda.is_available():
        dev = torch.cuda.current_device()
        print(f"GPU    : {torch.cuda.get_device_name(dev)}")
        n = torch.cuda.device_count()
        print(f"Devices: {n}")
        # Quick GPU sanity check
        a = torch.rand(1024, 1024, device="cuda")
        b = torch.rand(1024, 1024, device="cuda")
        c = a @ b
        torch.cuda.synchronize()
        print(f"Matmul 1024x1024 OK (sum={float(c.sum()):.2f})")
    else:
        print("[WARNING] No GPU detected; running on CPU.")

    print("-" * 55)
    for name in ("numpy", "pandas", "scipy", "sklearn", "matplotlib",
                 "transformers", "datasets", "accelerate", "cv2"):
        try:
            mod = __import__(name)
            ver = getattr(mod, "__version__", "?")
            print(f"{name:<14}: {ver}")
        except ImportError:
            print(f"{name:<14}: [not installed]")
    print("=" * 55)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
