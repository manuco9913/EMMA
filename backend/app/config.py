from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql://wavesim:wavesim@localhost:5432/wavesim"
    data_dir: str = "./data"

    model_config = {"env_file": ".env"}


settings = Settings()
