// PaddleOCR PP-OCRv5 mobile artifacts, pinned to immutable upstream revisions.
// Shared by scripts/fetch-ocr-models.mjs and wxt.config.ts. Licenses: Apache-2.0.
export const PADDLE_FILES = [
  {
    name: 'det.onnx',
    url: 'https://huggingface.co/PaddlePaddle/PP-OCRv5_mobile_det_onnx/resolve/e6f4fa85f00e168c862bc462aebca69eef9b3d3d/inference.onnx',
    sha256: 'a431985659dc921974177a95adcfbb90fd9e51989a5e04d70d0b75f597b6e61d',
  },
  {
    name: 'rec.onnx',
    url: 'https://huggingface.co/PaddlePaddle/PP-OCRv5_mobile_rec_onnx/resolve/ed152b8b495f84de93cda5709d768548a9127622/inference.onnx',
    sha256: 'da72dc72ca4dc220df0dfde68c1dedc31c58d3e76a25871122e5056227d50092',
  },
  {
    name: 'dict.txt',
    url: 'https://raw.githubusercontent.com/PaddlePaddle/PaddleOCR/a38c087bcb2579f9ccc2068aea02ec893b1c2311/ppocr/utils/dict/ppocrv5_dict.txt',
    sha256: 'd1979e9f794c464c0d2e0b70a7fe14dd978e9dc644c0e71f14158cdf8342af1b',
  },
];
