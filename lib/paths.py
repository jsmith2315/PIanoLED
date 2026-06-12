import os
import shutil


REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_ROOT = os.environ.get("PIANOLED_DATA_DIR", os.path.join(REPO_ROOT, "data"))

DATA_CONFIG_DIR = os.path.join(DATA_ROOT, "config")
SONGS_DIR = os.path.join(DATA_ROOT, "Songs")
SONG_CACHE_DIR = os.path.join(SONGS_DIR, "cache")
PRESETS_DIR = os.path.join(DATA_CONFIG_DIR, "presets")

SETTINGS_PATH = os.path.join(DATA_CONFIG_DIR, "settings.xml")
SEQUENCES_PATH = os.path.join(DATA_CONFIG_DIR, "sequences.xml")
LOG_PATH = os.path.join(DATA_ROOT, "visualizer.log")
SCORE_LOG_PATH = os.path.join(DATA_ROOT, "score_log.txt")

DEFAULT_SETTINGS_PATH = os.path.join(REPO_ROOT, "config", "default_settings.xml")
DEFAULT_SEQUENCES_PATH = os.path.join(REPO_ROOT, "config", "sequences.xml")
LEGACY_SETTINGS_PATH = os.path.join(REPO_ROOT, "config", "settings.xml")
LEGACY_SEQUENCES_PATH = os.path.join(REPO_ROOT, "config", "sequences.xml")
LEGACY_SONGS_DIR = os.path.join(REPO_ROOT, "Songs")
LEGACY_SONG_CACHE_DIR = os.path.join(LEGACY_SONGS_DIR, "cache")
LEGACY_PRESETS_DIR = os.path.join(REPO_ROOT, "config", "presets")


def songs_path(*parts):
    return os.path.join(SONGS_DIR, *parts)


def song_cache_path(*parts):
    return os.path.join(SONG_CACHE_DIR, *parts)


def presets_path(*parts):
    return os.path.join(PRESETS_DIR, *parts)


def _seed_file(target_path, source_candidates):
    if os.path.exists(target_path):
        return

    os.makedirs(os.path.dirname(target_path), exist_ok=True)
    for source_path in source_candidates:
        if source_path and os.path.exists(source_path):
            shutil.copy2(source_path, target_path)
            return


def _copy_directory_contents(source_dir, target_dir):
    if not os.path.isdir(source_dir):
        return

    os.makedirs(target_dir, exist_ok=True)
    for entry in os.scandir(source_dir):
        source_path = entry.path
        target_path = os.path.join(target_dir, entry.name)
        if os.path.exists(target_path):
            continue
        if entry.is_dir():
            shutil.copytree(source_path, target_path)
        else:
            shutil.copy2(source_path, target_path)


def _directory_has_user_content(path):
    if not os.path.isdir(path):
        return False
    for entry in os.scandir(path):
        if entry.name == "cache":
            continue
        return True
    return False


def ensure_data_layout():
    os.makedirs(DATA_CONFIG_DIR, exist_ok=True)
    os.makedirs(SONG_CACHE_DIR, exist_ok=True)
    os.makedirs(PRESETS_DIR, exist_ok=True)

    _seed_file(SETTINGS_PATH, [LEGACY_SETTINGS_PATH, DEFAULT_SETTINGS_PATH])
    _seed_file(SEQUENCES_PATH, [LEGACY_SEQUENCES_PATH, DEFAULT_SEQUENCES_PATH])

    if not _directory_has_user_content(SONGS_DIR):
        _copy_directory_contents(LEGACY_SONGS_DIR, SONGS_DIR)
    _copy_directory_contents(LEGACY_SONG_CACHE_DIR, SONG_CACHE_DIR)
    _copy_directory_contents(LEGACY_PRESETS_DIR, PRESETS_DIR)


ensure_data_layout()
