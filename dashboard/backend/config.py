from pathlib import Path

from pydantic_settings import BaseSettings

_ENV_FILE = Path(__file__).parent / ".env"


class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://postgres:postgres@localhost/antijitter"
    secret_key: str = "change-me-in-production-use-openssl-rand-hex-32"
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 60 * 24 * 7  # 7 days

    stripe_secret_key: str = ""
    stripe_webhook_secret: str = ""
    stripe_price_solo: str = ""    # price_XXXX from Stripe dashboard
    stripe_price_family: str = ""  # price_XXXX from Stripe dashboard

    vps_ip: str = ""
    server_wg_public_key: str = ""
    wg_interface: str = "wg0"

    # Germany VPS peer-management API (runs alongside the bonding server)
    bonding_peer_api_url: str = "http://178.104.168.177:4568"
    bonding_peer_api_token: str = ""
    # Comma-separated public destination IPs/hosts for bonding traffic.
    # Windows needs distinct destination IPs to keep multiple physical
    # adapters from collapsing onto the same best route.
    bonding_hosts: str = "178.104.168.177"

    class Config:
        env_file = _ENV_FILE
        env_file_encoding = "utf-8"


settings = Settings()
