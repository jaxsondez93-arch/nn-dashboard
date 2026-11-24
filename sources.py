"""Reading the outside world: log files, systemd, /proc and /sys. Nothing here writes anything.

Every reader fails soft (returns empty/None) so one missing file can never take the dashboard down."""
import datetime, glob, json, os, subprocess


def jsonl(path):
    out = []
    try:
        with open(path) as f:
            for line in f:
                try:
                    out.append(json.loads(line))
                except ValueError:
                    pass
    except OSError:
        pass
    return out



def sh(args, t=3):
    try:
        return subprocess.run(args, capture_output=True, text=True, timeout=t).stdout
    except Exception:
        return ""


def unit(name):
    d = {}
    for line in sh(["systemctl", "--user", "show", name, "-p", "MainPID", "-p", "ActiveState", "-p", "SubState",
                    "-p", "NRestarts", "-p", "ActiveEnterTimestamp", "-p", "MemoryCurrent"]).splitlines():
        if "=" in line:
            k, v = line.split("=", 1)
            d[k] = v
    return d


def rd(p):
    try:
        with open(p) as _f:
            return _f.read().strip()
    except OSError:
        return None


def host(data_dir):
    h = {}
    up = rd("/proc/uptime")
    h["uptime_s"] = float(up.split()[0]) if up else None
    mi = {}
    for line in (rd("/proc/meminfo") or "").splitlines():
        a = line.split()
        if len(a) >= 2:
            mi[a[0].rstrip(":")] = int(a[1])
    h["mem_avail_mb"] = mi.get("MemAvailable", 0) // 1024
    h["mem_total_mb"] = mi.get("MemTotal", 0) // 1024
    h["swap_used_mb"] = (mi.get("SwapTotal", 0) - mi.get("SwapFree", 0)) // 1024
    h["load1"] = float((rd("/proc/loadavg") or "0").split()[0])
    for nm in ("cpu", "memory", "io"):
        for line in (rd(f"/proc/pressure/{nm}") or "").splitlines():
            if line.startswith("some"):
                h[f"psi_{nm}60"] = float(line.split("avg60=")[1].split()[0])
    for hw in glob.glob("/sys/class/hwmon/hwmon*"):
        if rd(hw + "/name") == "coretemp" and rd(hw + "/temp1_input"):
            h["pkg_temp_c"] = int(rd(hw + "/temp1_input")) // 1000
    h["throttle_count"] = int(rd("/sys/devices/system/cpu/cpu0/thermal_throttle/package_throttle_count") or 0)
    h["cpu_mhz"] = int(rd("/sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq") or 0) // 1000
    h["ac"] = rd("/sys/class/power_supply/AC/online")
    h["bat_pct"] = rd("/sys/class/power_supply/BAT0/capacity")
    h["bat_status"] = rd("/sys/class/power_supply/BAT0/status")
    st = os.statvfs(data_dir)
    h["disk_free_gb"] = round(st.f_bavail * st.f_frsize / 2**30, 1)
    return h


def iso_to_epoch(s):
    try:
        return datetime.datetime.strptime(s, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=datetime.timezone.utc).timestamp()
    except ValueError:
        return None


def demo_host(hb):
    hb = hb or {}
    return dict(uptime_s=37 * 60.0, mem_avail_mb=11500, mem_total_mb=16000, swap_used_mb=0, load1=float(hb.get("load") or 1.0), psi_cpu60=0.0, psi_memory60=0.0, psi_io60=0.0,
                pkg_temp_c=int(hb.get("cpu_c") or 70), throttle_count=0, cpu_mhz=3300, ac="1", bat_pct=str(hb.get("bat_pct") or 80), bat_status="Charging", disk_free_gb=120.0)


def demo_unit():
    return dict(ActiveState="active", SubState="running", NRestarts="0", MainPID="0", MemoryCurrent="0", ActiveEnterTimestamp="demo")

