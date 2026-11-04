/* global process, console, fetch, Buffer */
// Downloads the models the app runs on its own CPU into one folder, at image build time, so a container never
// fetches anything when it starts and never depends on a download at the moment someone uploads a file.
//   node infra/fetch-models.mjs /app/models
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2] ?? 'models';
mkdirSync(dir, { recursive: true });

const { pipeline, env } = await import('@huggingface/transformers');
env.cacheDir = dir;
const embed = await pipeline('feature-extraction', 'Xenova/bge-small-en-v1.5', { dtype: 'q8' });
const [vector] = (await embed(['ready'], { pooling: 'cls', normalize: true })).tolist();
console.log(`embedding model ready, ${vector.length} dimensions`);

// Tesseract's "fast" English model, read straight from this folder by the app (OCR_CACHE_DIR)
const tesseract = join(dir, 'tesseract');
mkdirSync(tesseract, { recursive: true });
const res = await fetch('https://github.com/tesseract-ocr/tessdata_fast/raw/4.1.0/eng.traineddata');
if (!res.ok) throw new Error(`Could not fetch the OCR model: ${res.status}`);
writeFileSync(join(tesseract, 'eng.traineddata'), Buffer.from(await res.arrayBuffer()));
console.log('OCR language model ready');
