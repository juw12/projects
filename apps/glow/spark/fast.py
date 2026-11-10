"""Ask Windows to run this process at full speed: above-normal priority and no background power throttling.

The laptop is shared with a busy browser, so a normal-priority background job was getting a few percent of the CPU.
Above-normal (not high or realtime) keeps the desktop responsive. Import this module before torch.
"""
import ctypes
import os
import sys

os.environ.setdefault("KMP_BLOCKTIME", "0")
os.environ.setdefault("OMP_WAIT_POLICY", "PASSIVE")

ABOVE_NORMAL_PRIORITY_CLASS = 0x00008000
PROCESS_POWER_THROTTLING = 4
EXECUTION_SPEED = 0x1


class PowerThrottlingState(ctypes.Structure):
    _fields_ = [("Version", ctypes.c_ulong), ("ControlMask", ctypes.c_ulong), ("StateMask", ctypes.c_ulong)]


def apply():
    if sys.platform != "win32":
        return "not windows"
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.GetCurrentProcess.restype = ctypes.c_void_p
    kernel32.SetPriorityClass.argtypes = [ctypes.c_void_p, ctypes.c_ulong]
    kernel32.SetProcessInformation.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_void_p, ctypes.c_ulong]
    process = kernel32.GetCurrentProcess()
    priority_ok = bool(kernel32.SetPriorityClass(process, ABOVE_NORMAL_PRIORITY_CLASS))
    state = PowerThrottlingState(1, EXECUTION_SPEED, 0)
    throttle_ok = bool(
        kernel32.SetProcessInformation(process, PROCESS_POWER_THROTTLING, ctypes.byref(state), ctypes.sizeof(state))
    )
    return f"priority above-normal={priority_ok} power-throttling-off={throttle_ok}"


print("fast:", apply(), flush=True)
