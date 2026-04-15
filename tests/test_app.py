from fastapi.testclient import TestClient

from app.main import app


def test_home_ok():
    client = TestClient(app)
    response = client.get("/")
    assert response.status_code == 200
    assert "입금 요청 관리" in response.text


def test_first_admin_can_be_super_without_actor():
    client = TestClient(app)
    payload = {"name": "root", "email": "root@example.com", "role": "super"}
    create = client.post("/admins", json=payload)
    assert create.status_code == 200
    assert create.json()["role"] == "super"


def test_brand_creation_returns_viewer_url():
    client = TestClient(app)
    payload = {
        "name": "브랜드A",
        "sync_mode": "manual",
        "template_columns": ["옵션A", "옵션B"],
    }
    create = client.post("/brands", json=payload)
    assert create.status_code == 200
    body = create.json()
    assert body["viewer_path"].startswith("/viewer/")
    assert body["viewer_url"].endswith(body["viewer_path"])
