"""All configuration, in one place, read from environment variables (see the README table).

`settings` is a single shared object. Most values never change after start-up; `data_dir` and `train_unit` can be switched at run time by `snapshot.pick_run()`
when several training runs are configured with NN_RUNS."""
import os

HOME = os.path.expanduser("~")
LOOPBACK = ("127.0.0.1", "::1")


class Settings:
    def __init__(self):
        self.reload()

    def reload(self, env=None):
        env = os.environ if env is None else env
        self.data_dir = env.get("NN_DATA", HOME + "/nn_data")             # training data: logs/, ckpt/, labels/
        self.work_dir = env.get("NN_WORK", HOME + "/nn_overnight")        # where the optional 5-minute sampler writes samples.tsv
        self.config_dir = env.get("NN_DASH_CONFIG", HOME + "/.config/nn-dashboard")   # login secrets live here
        self.train_unit = env.get("NN_TRAIN_UNIT", "nn-train.service")    # systemd user unit shown as "the trainer"
        self.demo = env.get("NN_DASH_DEMO") == "1"                        # synthetic machine/service cards: no real machine data appears
        # NN_RUNS="dir=unit;dir=unit": follow whichever run is active (see snapshot.pick_run). Unset = fixed data_dir / train_unit.
        self.runs = [tuple(x.split("=", 1)) for x in env.get("NN_RUNS", "").split(";") if "=" in x]
        self.port = int(env.get("NN_DASH_PORT", "8765"))
        self.bind = env.get("NN_DASH_BIND", "127.0.0.1")
        self.noauth = env.get("NN_DASH_NOAUTH") == "1" and self.bind in LOOPBACK   # never serve unauthenticated off-loopback


settings = Settings()
