from fastapi.testclient import TestClient

from app.main import app
from app.sessions import store


client = TestClient(app)
AUTH = {'Authorization': 'Bearer local-ai-service-token'}


def test_health_and_capabilities():
    health = client.get('/health')
    assert health.status_code == 200
    assert health.json()['service'] == 'rmo-ai-service'

    ready = client.get('/ready')
    assert ready.status_code == 200
    assert ready.json()['status'] == 'ready'

    caps = client.get('/capabilities')
    body = caps.json()
    assert body['processing']['frameExtraction'] is True
    assert body['processing']['faceIdentification'] is False


def test_session_lifecycle_and_frame_counter():
    denied = client.post('/sessions/start', json={
        'jobId': 1, 'callId': 10, 'divisionId': 2, 'lobbyId': 3,
    })
    assert denied.status_code == 401

    started = client.post('/sessions/start', headers=AUTH, json={
        'jobId': 7, 'callId': 10, 'divisionId': 2, 'lobbyId': 3,
    })
    assert started.status_code == 200
    assert started.json()['status'] == 'RUNNING'

    again = client.post('/sessions/start', headers=AUTH, json={
        'jobId': 7, 'callId': 10, 'divisionId': 2, 'lobbyId': 3,
    })
    assert again.status_code == 200

    frame = client.post('/sessions/7/frames', headers=AUTH, content=b'\xff\xd8\xff\xd9')
    assert frame.status_code == 200
    assert frame.json()['framesReceived'] >= 1
    assert frame.json()['framesProcessed'] >= 1

    status = client.get('/sessions/7/status', headers=AUTH)
    assert status.status_code == 200
    assert status.json()['jobId'] == 7

    stopped = client.post('/sessions/7/stop', headers=AUTH)
    assert stopped.status_code == 200
    assert stopped.json()['status'] == 'STOPPED'

    duplicate = client.post('/sessions/7/stop', headers=AUTH)
    assert duplicate.status_code == 200
    assert duplicate.json()['status'] == 'STOPPED'

    # Clear for isolation if more tests add sessions.
    store.stop(7)
