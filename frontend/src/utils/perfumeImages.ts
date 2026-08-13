import type { Perfume } from '../types';

// Imagens com fundo branco auditadas visualmente e convertidas para AVIF.
// As demais continuam usando a imagem original para preservar cenários e transparências.
const LOCAL_AVIF_SEQUENCES = new Set([
  54, 56, 57, 58, 59, 64, 79, 106, 108, 109, 111, 113, 114, 115, 116, 117,
  118, 119, 120, 121, 122, 124, 125, 126, 128, 130, 131, 132, 133, 134, 135,
  136, 137, 138, 139, 140, 141, 142, 144, 145, 146, 149, 150, 151, 152, 153,
  155, 156, 157, 158, 159, 160, 161, 162, 164, 165, 166, 167, 168, 169, 171,
  172, 173, 174, 175, 176, 177, 178, 179, 180, 183, 184, 185, 186, 187, 188,
  189, 190, 191, 192, 193, 194, 195, 196, 197, 198, 200, 201, 202, 203, 204,
  206, 207, 208, 209, 210, 211, 212, 213, 214, 215, 221, 222, 236, 238, 239,
  242, 243, 244, 247, 250, 251, 252, 253, 254, 255, 256, 257, 258, 259, 260,
  261, 262, 264, 265, 267, 268, 269, 270, 271, 272, 273, 274, 276, 277, 278,
  279, 280, 281, 282, 283, 285, 288, 289, 290, 291, 292, 293, 295, 296, 297,
  298, 299, 300, 301, 302, 303, 304, 305, 306, 307, 308, 309, 310, 311, 312,
  313, 315, 316, 320, 321, 323, 325, 326, 327, 328, 329, 330, 332, 335, 337,
  338, 339, 342, 343, 344, 345, 346, 347, 348, 349, 351, 352, 353, 354, 355,
  356, 357, 358, 359, 360, 361, 363, 365, 366, 367, 368, 369, 370, 371, 373,
  374, 375, 377, 378, 379, 380, 381, 382, 383, 384, 385, 386, 387, 390, 391,
  392, 393, 394, 395, 396, 397, 399, 400, 401, 402, 403, 404, 405, 407, 408,
  409, 410, 411, 412, 413, 414, 415, 416,
]);

const PRODUCTION_ORIGIN = 'https://lessence-furlani-vitrine.onrender.com';

function imageOrigin(): string {
  if (typeof window !== 'undefined' && window.location?.origin) return window.location.origin;
  return PRODUCTION_ORIGIN;
}

export function resolvePerfumeImageUrl(perfume: Perfume): string {
  const sequence = Number(perfume.seq);
  if (!LOCAL_AVIF_SEQUENCES.has(sequence)) return perfume.imagemUrl;
  return `${imageOrigin()}/perfume-images/perfume-${String(sequence).padStart(3, '0')}.avif`;
}

export function withOptimizedPerfumeImages(perfumes: Perfume[]): Perfume[] {
  return perfumes.map((perfume) => ({
    ...perfume,
    imagemUrl: resolvePerfumeImageUrl(perfume),
  }));
}

