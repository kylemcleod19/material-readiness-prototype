from fastapi import Header

from app.services.common import Actor

ROLES = ("planning", "purchasing", "warehouse", "qa")


def get_actor(x_demo_role: str = Header(default="purchasing"), x_demo_user: str = Header(default="")) -> Actor:
    """Demo role switcher context. Not authentication or authorization."""
    role = x_demo_role if x_demo_role in ROLES else "purchasing"
    return Actor(name=x_demo_user or f"demo-{role}", role=role, channel="manual")
