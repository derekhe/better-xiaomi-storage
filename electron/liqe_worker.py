"""Local LIQE inference. Adapted from zwx8981/LIQE (MIT), Copyright 2024 Weixia Zhang.

Deterministically samples up to 15 spatial crops; photos never leave this process.
Only tensor checkpoints are accepted. See THIRD_PARTY_NOTICES.md.
"""
import argparse
import base64
import io
import itertools
import json
import sys
from pathlib import Path

QUALITIES = ['bad', 'poor', 'fair', 'good', 'perfect']
SCENES = ['animal', 'cityscape', 'human', 'indoor', 'landscape', 'night', 'plant', 'still_life', 'others']
DISTORTIONS = ['jpeg2000 compression', 'jpeg compression', 'noise', 'blur', 'color', 'contrast', 'overexposure', 'underexposure', 'spatial', 'quantization', 'other']

def send(message):
    print(json.dumps(message, ensure_ascii=True), flush=True)

def run(runtime):
    import torch
    import clip
    import numpy as np
    from PIL import Image, ImageOps
    torch.set_num_threads(2)
    device = 'cuda:0' if torch.cuda.is_available() else 'cpu'
    # Base CLIP is read from a prepared local cache; startup performs no downloads.
    model, _ = clip.load(str(runtime / 'ViT-B-32.pt'), device=device, jit=False)
    checkpoint = torch.load(runtime / 'LIQE.pt', map_location='cpu', weights_only=True)
    # Official multitask checkpoint contains the fine-tuned visual encoder.
    if 'visual.conv1.weight' in checkpoint:
        model.load_state_dict(checkpoint)
    else:
        model.visual.load_state_dict(checkpoint)
    model.eval()
    if device == 'cpu': model.float()
    with torch.inference_mode():
        prompts = [f'a photo of a {scene} with {distortion} artifacts, which is of {quality} quality' for quality, scene, distortion in itertools.product(QUALITIES, SCENES, DISTORTIONS)]
        # Bound temporary GPU memory while encoding the fixed prompts.
        text = torch.cat([model.encode_text(clip.tokenize(prompts[i:i + 64]).to(device)) for i in range(0, len(prompts), 64)])
        text = text / text.norm(dim=-1, keepdim=True)
    send({'type': 'ready', 'device': device})
    for line in sys.stdin:
        if len(line) > 16 * 1024 * 1024: continue
        request = json.loads(line)
        try:
            image = ImageOps.exif_transpose(Image.open(io.BytesIO(base64.b64decode(request['image'], validate=True)))).convert('RGB')
            if image.width < 9 or image.height < 9: raise ValueError('small image')
            # Keep aspect ratio, use a 512px short side, and cap panoramic inputs.
            scale = min(512 / min(image.size), 1536 / max(image.size))
            image = image.resize((max(224, round(image.width * scale)), max(224, round(image.height * scale))), Image.Resampling.BICUBIC)
            pixels = torch.from_numpy(np.array(image, dtype=np.float32) / 255).permute(2, 0, 1).unsqueeze(0).to(device)
            mean = pixels.new_tensor([.48145466, .4578275, .40821073]).view(1, 3, 1, 1)
            std = pixels.new_tensor([.26862954, .26130258, .27577711]).view(1, 3, 1, 1)
            patches = ((pixels - mean) / std).unfold(2, 224, 32).unfold(3, 224, 32).permute(0, 2, 3, 1, 4, 5).reshape(-1, 3, 224, 224)
            count = min(15, patches.shape[0])
            indices = torch.linspace(0, patches.shape[0] - 1, count, device=device).round().long()
            with torch.inference_mode():
                features = model.encode_image(patches[indices])
                features = features / features.norm(dim=-1, keepdim=True)
                joint = (model.logit_scale.exp() * features @ text.T).float().mean(0).softmax(0).reshape(5, 9, 11)
                probabilities = joint.sum((1, 2))
                quality = float((probabilities * torch.arange(1, 6, device=device)).sum())
                distortion = joint.sum((0, 1)); scene = joint.sum((0, 2))
                result = {'quality': quality, 'probabilities': probabilities.cpu().tolist(), 'scene': SCENES[int(scene.argmax())], 'distortion': DISTORTIONS[int(distortion.argmax())], 'confidence': float(distortion.max())}
            send({'id': request['id'], 'result': result})
        except Exception:
            send({'id': request.get('id'), 'error': 'unsupported preview'})

if __name__ == '__main__':
    args = argparse.ArgumentParser()
    args.add_argument('--runtime', required=True)
    try: run(Path(args.parse_args().runtime))
    except Exception: send({'type': 'fatal'})
