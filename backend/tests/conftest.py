import os
import tempfile

# TEST_DATABASE_URL must point to a disposable database: the fixture drops its tables.
os.environ["DATABASE_URL"] = os.getenv("TEST_DATABASE_URL") or "sqlite:///" + os.path.join(tempfile.mkdtemp(), "test.db")

import pytest

from app.db import Base, engine


@pytest.fixture(autouse=True)
def fresh_db():
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    yield
