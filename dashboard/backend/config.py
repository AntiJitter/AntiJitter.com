from pydantic_settings import BaseSettings


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

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


settings = Settings()
