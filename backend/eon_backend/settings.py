"""
Django settings for the EON backend.

Every value that differs between local/staging/production is read from the
environment (see .env.example) — nothing environment-specific is hardcoded
here, so this file is safe to commit.
"""
import os
from datetime import timedelta
from pathlib import Path

from django.core.exceptions import ImproperlyConfigured
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / '.env')


def env_bool(name, default=False):
    val = os.environ.get(name)
    if val is None:
        return default
    return val.strip().lower() in ('1', 'true', 'yes', 'on')


def env_list(name, default=''):
    val = os.environ.get(name, default)
    return [item.strip() for item in val.split(',') if item.strip()]


# --- Core security settings (Phase 6.1) ----------------------------------
# DEBUG defaults to False (fail closed) — a deployment that forgets to set
# DJANGO_DEBUG no longer accidentally serves Django's debug error pages
# (stack traces, settings dump) to the internet. Local dev sets it via
# .env (see .env.example / backend/README.md "cp .env.example .env").
DEBUG = env_bool('DJANGO_DEBUG', False)

# No insecure fallback: a missing/blank DJANGO_SECRET_KEY now fails at
# startup instead of silently signing sessions/JWTs with a public,
# hardcoded string. Every documented setup path (backend/README.md) starts
# with `cp .env.example .env`, which already ships a real key placeholder.
SECRET_KEY = os.environ.get('DJANGO_SECRET_KEY', '').strip()
if not SECRET_KEY:
    raise ImproperlyConfigured(
        'DJANGO_SECRET_KEY is not set. Copy .env.example to .env and set '
        'a real value (see backend/README.md).'
    )

ALLOWED_HOSTS = env_list('DJANGO_ALLOWED_HOSTS', 'localhost,127.0.0.1')

INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    # third-party
    'rest_framework',
    'rest_framework_simplejwt',
    'rest_framework_simplejwt.token_blacklist',
    'corsheaders',
    'django_filters',
    # local apps
    'products',
    'orders',
    'users',
    'inventory',
    'customers',
    'analytics',
    'reports',
]

MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'whitenoise.middleware.WhiteNoiseMiddleware',
    'corsheaders.middleware.CorsMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'eon_backend.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.debug',
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'eon_backend.wsgi.application'
ASGI_APPLICATION = 'eon_backend.asgi.application'

# --- Database ---------------------------------------------------------
# Defaults to local Postgres values; override via .env for staging/prod.
DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.postgresql',
        'NAME': os.environ.get('DB_NAME', 'eon_db'),
        'USER': os.environ.get('DB_USER', 'eon_user'),
        'PASSWORD': os.environ.get('DB_PASSWORD', ''),
        'HOST': os.environ.get('DB_HOST', 'localhost'),
        'PORT': os.environ.get('DB_PORT', '5432'),
    }
}

AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator'},
    {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator'},
    {'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator'},
    {'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator'},
]

LANGUAGE_CODE = 'en-us'
TIME_ZONE = os.environ.get('DJANGO_TIME_ZONE', 'UTC')
USE_I18N = True
USE_TZ = True

STATIC_URL = 'static/'
STATIC_ROOT = BASE_DIR / 'staticfiles'
STATICFILES_STORAGE = 'whitenoise.storage.CompressedManifestStaticFilesStorage'
MEDIA_URL = 'media/'
MEDIA_ROOT = BASE_DIR / 'media'

# Django's default in-memory upload cap is 2.5MB, which is below the
# frontend's own 5MB-per-original-file limit (src/lib/storage.js /
# djangoStorage.js MAX_IMAGE_BYTES). Raised to match so a legitimately
# sized (pre-optimization) product photo upload doesn't 400 before it
# even reaches the view. The frontend already resizes to WebP before
# upload, so actual multipart bodies are normally far smaller than this.
DATA_UPLOAD_MAX_MEMORY_SIZE = int(os.environ.get('DATA_UPLOAD_MAX_MEMORY_SIZE', 10 * 1024 * 1024))
FILE_UPLOAD_MAX_MEMORY_SIZE = int(os.environ.get('FILE_UPLOAD_MAX_MEMORY_SIZE', 10 * 1024 * 1024))

# Telegram order-alert bot (see backend/orders/notifications.py). Both
# blank by default so a deployment that hasn't set these up yet simply
# skips sending (logged, not raised) rather than crashing order creation.
TELEGRAM_BOT_TOKEN = os.environ.get('TELEGRAM_BOT_TOKEN', '').strip()
TELEGRAM_CHAT_ID = os.environ.get('TELEGRAM_CHAT_ID', '').strip()

DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

# --- DRF / JWT ----------------------------------------------------------
# Admin-only auth: there are no customer accounts. Every write endpoint
# requires a staff JWT; product reads and order creation stay public so
# the storefront and checkout keep working without login.
REST_FRAMEWORK = {
    'DEFAULT_AUTHENTICATION_CLASSES': (
        'rest_framework_simplejwt.authentication.JWTAuthentication',
    ),
    'DEFAULT_PERMISSION_CLASSES': (
        'rest_framework.permissions.IsAuthenticatedOrReadOnly',
    ),
    'DEFAULT_PAGINATION_CLASS': 'rest_framework.pagination.PageNumberPagination',
    'PAGE_SIZE': 24,
    # No DEFAULT_THROTTLE_CLASSES on purpose — this must not affect any
    # existing endpoint. Only the 'admin-login' scope is used, by
    # users/throttles.py -> AdminLoginThrottle, attached solely to
    # AdminLoginView (see users/views.py). Every other view is unthrottled,
    # exactly as before Phase 6.1.
    'DEFAULT_THROTTLE_RATES': {
        'admin-login': os.environ.get('ADMIN_LOGIN_THROTTLE_RATE', '5/min'),
    },
}

SIMPLE_JWT = {
    'ACCESS_TOKEN_LIFETIME': timedelta(hours=1),
    'REFRESH_TOKEN_LIFETIME': timedelta(days=7),
    'ROTATE_REFRESH_TOKENS': True,
    # ROTATE_REFRESH_TOKENS alone issues a new refresh token on every
    # /auth/refresh/ call but never invalidates the one it replaced — a
    # rotated-away refresh token stayed fully usable (mint new access
    # tokens with it) until its own 7-day expiry, which defeats the point
    # of rotation. BLACKLIST_AFTER_ROTATION closes that: the token being
    # replaced is blacklisted the moment it's used to rotate.
    # Requires 'rest_framework_simplejwt.token_blacklist' in INSTALLED_APPS
    # (added above) and `python manage.py migrate` — that app ships its
    # own bundled migrations, nothing added to this repo's migrations.
    # Non-breaking: every currently-outstanding refresh token keeps
    # working exactly as before; only a token gets blacklisted once it's
    # actually rotated, which is the new, intended behavior.
    'BLACKLIST_AFTER_ROTATION': True,
}

# --- CORS -----------------------------------------------------------------
# The Vite dev server and production frontend origin(s) — comma-separated
# in .env, e.g. CORS_ALLOWED_ORIGINS=http://localhost:5173,https://eon.com
CORS_ALLOWED_ORIGINS = env_list(
    'CORS_ALLOWED_ORIGINS', 'http://localhost:5173,http://127.0.0.1:5173'
)
CORS_ALLOW_CREDENTIALS = True

# --- HTTPS / cookie hardening (Phase 6.1) ---------------------------------
# All environment-controlled, default OFF, so local HTTP dev is unaffected.
# Turn these on via .env once the app is served over HTTPS behind a real
# domain (see backend/README.md "Deployment checklist").
SECURE_SSL_REDIRECT = env_bool('DJANGO_SECURE_SSL_REDIRECT', False)
SESSION_COOKIE_SECURE = env_bool('DJANGO_SESSION_COOKIE_SECURE', False)
CSRF_COOKIE_SECURE = env_bool('DJANGO_CSRF_COOKIE_SECURE', False)

# 0 (default) disables HSTS entirely — matches Django's own default and
# keeps local/staging over plain HTTP working. Set to e.g. 31536000
# (1 year) in production once HTTPS is confirmed working end-to-end;
# enabling it prematurely on a broken HTTPS setup can lock out plain-HTTP
# access for the lifetime of the header.
SECURE_HSTS_SECONDS = int(os.environ.get('DJANGO_SECURE_HSTS_SECONDS', '0'))
SECURE_HSTS_INCLUDE_SUBDOMAINS = env_bool('DJANGO_SECURE_HSTS_INCLUDE_SUBDOMAINS', False)
SECURE_HSTS_PRELOAD = env_bool('DJANGO_SECURE_HSTS_PRELOAD', False)

# Only needed when running behind a reverse proxy (nginx/Caddy/etc.) that
# terminates TLS and forwards plain HTTP internally — tells Django to
# trust the proxy's X-Forwarded-Proto header instead of misreading every
# request as insecure. Off by default; enable only once the proxy is
# confirmed to set this header itself (an untrusted client-supplied value
# here would let a client spoof "https").
if env_bool('DJANGO_SECURE_PROXY_SSL_HEADER', False):
    SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')

# --- Logging (Phase 6.1) --------------------------------------------------
# Minimal, additive console logging — no external log service wired up.
# Django's own request/server logs plus a dedicated 'eon' logger apps can
# use (e.g. logging.getLogger('eon.orders')) without needing per-app
# config. Verbosity is env-controlled so prod can be quieter than dev.
LOGGING = {
    'version': 1,
    'disable_existing_loggers': False,
    'formatters': {
        'verbose': {
            'format': '[{asctime}] {levelname} {name}: {message}',
            'style': '{',
        },
    },
    'handlers': {
        'console': {
            'class': 'logging.StreamHandler',
            'formatter': 'verbose',
        },
    },
    'root': {
        'handlers': ['console'],
        'level': os.environ.get('DJANGO_LOG_LEVEL', 'INFO' if DEBUG else 'WARNING'),
    },
    'loggers': {
        'django': {
            'handlers': ['console'],
            'level': os.environ.get('DJANGO_LOG_LEVEL', 'INFO' if DEBUG else 'WARNING'),
            'propagate': False,
        },
        'django.request': {
            'handlers': ['console'],
            'level': 'ERROR',
            'propagate': False,
        },
        'eon': {
            'handlers': ['console'],
            'level': os.environ.get('DJANGO_LOG_LEVEL', 'INFO' if DEBUG else 'WARNING'),
            'propagate': False,
        },
    },
}
