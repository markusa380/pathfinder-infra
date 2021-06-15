import subprocess
import os
import shutil
import socket
import boto3
import multiprocessing
from botocore.errorfactory import ClientError
import datetime
import shutil
import glob

# Required env vars
CONFIG_FILE = os.environ["ARMA_CONFIG"]
DATA_BUCKET = os.environ["DATA_BUCKET"]
MISSIONS_BUCKET = os.environ["MISSIONS_BUCKET"]
MODS_BUCKET = os.environ["MODS_BUCKET"]
STEAM_USER = os.environ["STEAM_USER"]
STEAM_PASSWORD = os.environ["STEAM_PASSWORD"]
ARMA_BINARY = os.environ["ARMA_BINARY"]
ARMA_LIMITFPS = os.environ["ARMA_LIMITFPS"]
ARMA_WORLD = os.environ["ARMA_WORLD"]
ARMA_PROFILE = os.environ["ARMA_PROFILE"]
PORT = os.environ["PORT"]

# Optional env vars
STEAM_BRANCH = os.environ.get("STEAM_BRANCH")
STEAM_BRANCH_PASSWORD = os.environ.get("STEAM_BRANCH_PASSWORD")

MODS_DIR = "/arma3/mods"
KEYS_DIR = "/arma3/keys"
CONFIG_DIR = "/arma3/configs"
USERCONFIG_DIR = "/arma3/userconfig"
CBA_SETTINGS = "cba_settings.sqf"
MISSIONS_DIR = "/arma3/mpmissions"
CONFIG_NAME = "main.cfg"
HOMEDIR = "/root"
PROFILE_DIR = f"/root/.local/share/Arma 3 - Other Profiles/{ARMA_PROFILE}/"
PROFILE_FILE_NAME = ARMA_PROFILE + ".Arma3Profile"


def print_diskstats():
    total, used, free = shutil.disk_usage("/")
    print("Total: %d GiB" % (total // (2**30)), flush=True)
    print("Used: %d GiB" % (used // (2**30)), flush=True)
    print("Free: %d GiB" % (free // (2**30)), flush=True)


def makedir(dir):
    print("Making directory", dir)
    if not os.path.exists(dir):
        os.makedirs(dir)


def mkdirs():
    print("Making directories", flush=True)
    makedir(KEYS_DIR)
    makedir(MODS_DIR)
    makedir(MISSIONS_DIR)
    makedir(PROFILE_DIR)
    makedir(CONFIG_DIR)
    makedir(USERCONFIG_DIR)
    makedir("/arma3/steamapps") # Workaround for https://github.com/ValveSoftware/steam-for-linux/issues/7843
    # Don't create config dir as it's mounted
    print("All directories created", flush=True)

def init_steamcmd():
    steamcmd = ["/steamcmd/steamcmd.sh"]
    steamcmd.extend(["+login", STEAM_USER, STEAM_PASSWORD])
    steamcmd.extend(["+force_install_dir", "/arma3"])
    steamcmd.extend(["+app_update", "233780"])
    if STEAM_BRANCH != None and len(STEAM_BRANCH) > 0:
        steamcmd.extend(["-beta", STEAM_BRANCH])
    if STEAM_BRANCH_PASSWORD != None and len(STEAM_BRANCH_PASSWORD) > 0:
        steamcmd.extend(["-betapassword", STEAM_BRANCH_PASSWORD])
    steamcmd.extend(["validate", "+quit"])
    print("Starting SteamCmd", flush=True)
    subprocess.call(steamcmd)
    print("SteamCmd completed", flush=True)


def build_mods_string(d):
    launch = "\""
    mods = [os.path.join(d, o) for o in os.listdir(
        d) if os.path.isdir(os.path.join(d, o))]
    for m in mods:
        launch += m+";"
    for name in glob.glob(f'{d}/**/*.bikey', recursive=True):
        shutil.copy2(name, KEYS_DIR)
        print("Added bikey", name)
    return launch+"\""


def lowercase_rename(dir):
    # renames all subforders of dir, not including dir itself
    def rename_all(root, items):
        for name in items:
            try:
                os.rename(
                    os.path.join(root, name),
                    os.path.join(root, name.lower()))
            except OSError:
                pass  # can't rename it, so what
    # starts from the bottom so paths further up remain valid after renaming
    for root, dirs, files in os.walk(dir, topdown=False):
        rename_all(root, dirs)
        rename_all(root, files)


def download_mods():
    try:
        current_time = datetime.datetime.now()
        print(f"Downloading mods in {MODS_BUCKET} to {MODS_DIR}", flush=True)
        os.system(f"aws s3 sync s3://{MODS_BUCKET} {MODS_DIR} --quiet")
        diff = (datetime.datetime.now() - current_time).total_seconds()
        print(f"Download took {diff} seconds", flush=True)
        print("Making mod directories lowercase", flush=True)
        lowercase_rename(MODS_DIR)
        print("Done!", flush=True)
    except ClientError as err:
        # Not found
        print(
            f"Could not find or download mods in {MODS_BUCKET}", err, flush=True)
        pass


def download_cfg():
    s3 = boto3.client('s3')
    try:
        # Check exists
        s3.head_object(Bucket=DATA_BUCKET, Key=CONFIG_NAME)

        print(f"Downloading config {CONFIG_NAME} in {DATA_BUCKET}", flush=True)
        s3.download_file(DATA_BUCKET, CONFIG_NAME,
                         CONFIG_DIR + '/' + CONFIG_NAME)
        print("Done!", flush=True)
    except ClientError as err:
        # Not found
        print(
            f"Could not find or download config file {CONFIG_NAME}", err, flush=True)
        pass


def download_profile():
    s3 = boto3.client('s3')
    try:
        # Check exists
        s3.head_object(Bucket=DATA_BUCKET, Key=PROFILE_FILE_NAME)
        target = PROFILE_DIR + PROFILE_FILE_NAME
        print(
            f"Downloading .armaprofile {PROFILE_FILE_NAME} in {DATA_BUCKET} to {target}", flush=True)
        s3.download_file(
            DATA_BUCKET,
            PROFILE_FILE_NAME,
            target
        )
        print("Done!", flush=True)
    except ClientError as err:
        # Not found
        print(
            f"Could not find or download profile file {PROFILE_FILE_NAME}", err, flush=True)
        pass


def download_cba_settings():
    s3 = boto3.client('s3')
    try:
        # Check exists
        s3.head_object(Bucket=DATA_BUCKET, Key=CBA_SETTINGS)
        target = USERCONFIG_DIR + "/" + CBA_SETTINGS
        print(
            f"Downloading {CBA_SETTINGS} in {DATA_BUCKET} to {target}", flush=True)
        s3.download_file(
            DATA_BUCKET,
            CBA_SETTINGS,
            target
        )
        print("Done!", flush=True)
    except ClientError as err:
        # Not found
        print(
            f"Could not find or download file {CBA_SETTINGS}", err, flush=True)
        pass


def download_missions():
    s3 = boto3.client('s3')
    try:
        resp = s3.list_objects_v2(Bucket=MISSIONS_BUCKET)
        list = resp['Contents']
        for key in list:
            source = key['Key']
            target = MISSIONS_DIR + '/' + key['Key']
            print(
                f"Downloading mission {source} in {MISSIONS_BUCKET} to {target}", flush=True)
            s3.download_file(
                MISSIONS_BUCKET, key['Key'], MISSIONS_DIR + '/' + key['Key'])
    except ClientError as err:
        # Not found
        print(
            f"Could not download missions in {MISSIONS_BUCKET}", err, flush=True)
        pass

############################################################################################################################

try:
    print_diskstats()
    mkdirs()
    download_cfg()
    download_profile()
    download_cba_settings()
    download_mods()
    download_missions()
    init_steamcmd()
    print_diskstats()

    launch = "{} -filePatching -limitFPS={} -world={}".format(
        ARMA_BINARY, ARMA_LIMITFPS, ARMA_WORLD)

    # TODO: Absolute paths

    if os.path.exists("mods"):
        # TODO: This seems unfixable omg
        launch += " -mod={}".format(build_mods_string("mods"))

    launch += " -config=\"{}/{}\"".format(CONFIG_DIR, CONFIG_FILE)
    launch += " -port={} -name={}".format(PORT, ARMA_PROFILE)

    if os.path.exists("servermods"):
        launch += " -serverMod={}".format(build_mods_string("servermods"))

    print("Launching arma server with command:", launch, flush=True)
    os.system(launch)
except BaseException as e:
    print("Something went wrong", e, flush=True)
finally:
    healthcheck_process.kill()
    healthcheck_process.terminate()
