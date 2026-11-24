"""
Settings for running the test suite without PostgreSQL:

    python manage.py test --settings=DevopsPilot.test_settings
"""
from DevopsPilot.settings import *  # noqa: F401,F403

DATABASES = {"default": {"ENGINE": "django.db.backends.sqlite3", "NAME": BASE_DIR / "test.sqlite3"}}
ALERTS_SEND_IN_BACKGROUND = False