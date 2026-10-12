"""Download public, pinned model assets; this script never reads account data."""
import hashlib
import pathlib
import shutil
import sys
import urllib.request

ASSETS = [
    ('LIQE.pt', 'https://drive.usercontent.google.com/download?id=1GoKwUKNR-rvX11QbKRN8MuBZw2hXKHGh&export=download&confirm=t', '66526600218226c4bc34d4c06d11e47f0e71f910248fa103d39f9c8f46c63b82'),
    ('ViT-B-32.pt', 'https://openaipublic.azureedge.net/clip/models/40d365715913c9da98579312b702a82c18be219cc2a73407c4526f58eba950af/ViT-B-32.pt', '40d365715913c9da98579312b702a82c18be219cc2a73407c4526f58eba950af'),
]
def digest(path):
    with path.open('rb') as file: return hashlib.file_digest(file, 'sha256').hexdigest()

root = pathlib.Path(sys.argv[1]).resolve()
root.mkdir(parents=True, exist_ok=True)
for name, url, checksum in ASSETS:
    target = root / name
    if target.exists() and digest(target) == checksum:
        print(f'{name}: verified', flush=True)
        continue
    temporary = target.with_suffix('.download')
    with urllib.request.urlopen(url, timeout=60) as response, temporary.open('wb') as output:
        shutil.copyfileobj(response, output)
    if digest(temporary) != checksum: raise RuntimeError(f'{name}: checksum mismatch')
    temporary.replace(target)
    print(f'{name}: ready', flush=True)
