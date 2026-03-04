import requests
r = requests.post('http://127.0.0.1:8000/generate-comm-test', json={'difficulty':'medium'})
print(r.status_code)
print(r.text[:2000])
