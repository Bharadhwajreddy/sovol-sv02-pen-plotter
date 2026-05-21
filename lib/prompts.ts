// ChatGPT prompts for each pen type
// These are displayed in the UI and used to generate the correct image
// Optimized for perfect pen plotter replication

export const PROMPT_2MM = `You are a professional caricature artist creating a bold, clean line drawing optimized for a physical pen plotter with a 2mm sketch pen.

CRITICAL: This image will be physically drawn by a robotic pen plotter. Every line you draw will be traced exactly by a real pen on paper. Follow these rules precisely:

Study the attached photo carefully, then draw the caricature following this EXACT method:

═══════════════════════════════════════════════
STEP 1 — FIND THE FACE SHAPE
═══════════════════════════════════════════════
- Look at the overall shape of the face INCLUDING the hair as one combined silhouette
- Is it a teardrop? A peanut? An oval? A square? A heart?
- This single combined shape is the foundation of the entire drawing
- Draw it as ONE clean bold closed outline
- The chin and jaw should reflect the person's actual face shape
- Exaggerate the most distinctive aspect of the shape slightly:
  - Long face → make it a bit longer
  - Round face → make it rounder
  - Strong jaw → emphasise the jaw line
  - Large forehead → give it more space

═══════════════════════════════════════════════
STEP 2 — EYES (most important feature)
═══════════════════════════════════════════════
- Eyes are the soul of the caricature — give them the most attention
- Draw eyes as simple almond or rounded shapes
- Upper eyelid: one curved line
- Lower eyelid: one partial curved line (does NOT need to be complete — let it "disappear and reappear")
- Pupil: one circle
- Highlight: one small white dot inside the pupil
- Eyebrow: one bold filled or thick-stroked arch above each eye — slightly higher above the eye than in real life — match the actual shape (flat, arched, angled)
- Only add eyelashes if they are extremely prominent — maximum 4–5 simple curved lines

═══════════════════════════════════════════════
STEP 3 — NOSE
═══════════════════════════════════════════════
- Draw only the BULB of the nose (the rounded tip)
- Add two simple curved nostril lines on each side
- Only suggest the bridge with one or two short lines near the inner corner of each eye
- Make the nose slightly wider or larger than real life if distinctive

═══════════════════════════════════════════════
STEP 4 — MOUTH
═══════════════════════════════════════════════
- Upper lip: one curved M-shape or simple arc line
- Lower lip: one simple fuller curved line (slightly exaggerated)
- Smile line: one simple curved line on each side of the mouth
- If the person is smiling — push the smile wider and warmer than real
- Do NOT draw teeth detail — just a simple curved line for the smile opening

═══════════════════════════════════════════════
STEP 5 — FACE OUTLINE AND STRUCTURE (BOLD OUTLINE)
═══════════════════════════════════════════════
- Draw the outer face in ONE bold continuous stroke per side
- Start from the chin, sweep up the jawline to the ear, continue up to the forehead
- This line should be thick and bold — the thickest line in the drawing
- Add the ear: a simple C-shape at the right height
- Add the neck: two simple parallel curved lines from jaw down

═══════════════════════════════════════════════
STEP 6 — HAIR
═══════════════════════════════════════════════
- Draw hair as ONE large bold silhouette shape — not individual strands
- Add 3–6 simple curved lines INSIDE the hair shape to suggest direction and flow
- These should be loose and organic, NOT perfectly spaced

═══════════════════════════════════════════════
CRITICAL TECHNICAL RULES (FOR PHYSICAL PEN PLOTTER)
═══════════════════════════════════════════════
⚠️ MANDATORY — FAILURE TO FOLLOW WILL BREAK THE PLOTTER:

1. **COLOR REQUIREMENTS:**
   - ONLY pure black (#000000) lines on pure white (#FFFFFF) background
   - ZERO grey tones (no #808080, #CCCCCC, etc.)
   - ZERO transparency/alpha values
   - ZERO gradients or soft edges

2. **LINE REQUIREMENTS:**
   - All lines must be VECTOR PATHS (not raster/pixel fills)
   - Line weight: 1.5–2mm thick uniform stroke
   - Lines must be CONTINUOUS (no dashed or dotted lines)
   - Lines must be CLOSED SHAPES where appropriate (face outline, eyes, etc.)

3. **FORBIDDEN ELEMENTS:**
   - NO shading fills
   - NO pattern fills
   - NO blur effects
   - NO drop shadows
   - NO texture overlays
   - NO crosshatching or hatching of any kind

4. **IMAGE FORMAT:**
   - Aspect ratio: EXACTLY 9:10 portrait (900px × 1000px recommended)
   - Face should fill 70–80% of image height
   - Center the subject with equal margins
   - Clean white background — no paper texture

5. **QUALITY CHECKS:**
   - Zoom in to 400% — all lines should be crisp and clean
   - No stray pixels or artifacts
   - No overlapping duplicate lines
   - All shapes properly closed

6. **FINAL OUTPUT:**
   - Export as PNG with white background
   - No watermark, signature, border, or frame
   - File should be clean and ready for immediate plotter processing

Apply this transformation to the attached photo now. Remember: a physical robot will trace every line you draw.`;

export const PROMPT_06MM = `You are a professional portrait sketch artist creating a photorealistic fine-line ink portrait optimized for a physical pen plotter with a 0.6mm fine liner.

CRITICAL: This image will be physically drawn by a robotic pen plotter. Every line you draw will be traced exactly by a real 0.6mm pen on paper. Follow these rules precisely:

Study the attached photo carefully and draw an accurate, realistic portrait sketch of the person.

═══════════════════════════════════════════════
THE FUNDAMENTAL RULE — REALISTIC FINE LINE STYLE
═══════════════════════════════════════════════
This drawing will be printed by a physical pen plotter using a 0.6mm fine liner nib on white A4 paper. This means:
- Reproduce the person's actual features as accurately as possible
- NO exaggeration, NO caricature, NO distortion of proportions
- The person must look exactly like themselves — not a cartoon version
- Lines must be CLEAN, SHARP, and DELIBERATE
- Use line density and clustering to suggest tone and shadow instead of grey fills
- Still NO solid grey fills or gradients — only black lines and white space
- Output aspect ratio: 9:10 portrait

═══════════════════════════════════════════════
LINE WEIGHT HIERARCHY
═══════════════════════════════════════════════
Simulate line weight variation using line density:
- OUTER FACE AND HAIR CONTOUR — double line (two close parallel lines) for the boldest weight
- MAJOR FACIAL FEATURES — single clean confident lines
- FINE INTERIOR DETAILS — thinner, more delicate single lines
- SHADOW AREAS — suggest with 4–8 closely spaced fine parallel lines (contour hatching only — following the surface curve, NOT grid crosshatching)

═══════════════════════════════════════════════
STEP 1 — HEAD AND FACE PROPORTIONS
═══════════════════════════════════════════════
- Draw the head in accurate proportions — do NOT enlarge it
- Eyes sit roughly halfway down the head height
- Nose base is roughly halfway between eyes and chin
- Mouth sits roughly one third of the way between nose and chin
- Ear top aligns with the eyebrow, ear bottom with the nose base
- Reproduce the exact face shape of this specific person
- The outer face contour should be a clean double-outlined shape

═══════════════════════════════════════════════
STEP 2 — EYES (highest priority for likeness)
═══════════════════════════════════════════════
- Upper eyelid: one clean precise curved line, slightly thicker at the outer corner
- Lower eyelid: one clean partial curved line, subtle
- Iris: a clean circle — draw the portion visible accurately
- Pupil: a solid filled black circle centred in the iris
- Highlight: leave one small white dot in the upper portion of the pupil
- Eyelid crease: one fine curved line following the upper lid
- Eyebrows: draw with 6–10 short fine strokes following the exact direction of the brow hairs — match the actual thickness, arch height, and spacing precisely
- Eyelashes: 8–12 fine curved lines from the upper lid, 4–6 from the lower lid
- Glasses (if present): precise clean lines for frame shape, bridge, and temple arms

═══════════════════════════════════════════════
STEP 3 — NOSE (accurate structure)
═══════════════════════════════════════════════
- Bridge: two fine parallel lines descending from between the eyes
- Tip: one or two clean curved lines defining the nose tip shape
- Nostrils: two clean almond or teardrop shaped curves
- Nostril wings: a fine curved line from each nostril outward toward the cheek
- Reproduce the actual nose shape accurately

═══════════════════════════════════════════════
STEP 4 — MOUTH AND LIPS (accurate shape)
═══════════════════════════════════════════════
- Upper lip: reproduce the exact cupid's bow shape of this person
- Lower lip: draw the actual fullness and curve accurately
- Lip line: one clean precise line where the lips meet
- Philtrum: two fine lines from the base of the nose to upper lip
- Smile lines: fine curved lines at the corners of the mouth only if clearly visible

═══════════════════════════════════════════════
STEP 5 — FACE STRUCTURE AND SHADOW SUGGESTION
═══════════════════════════════════════════════
- Shadow areas (use CONTOUR HATCHING only):
  - Under the nose: 3–5 fine short lines
  - Under the lower lip: 3–5 fine short lines
  - Under the chin/jawline: 4–6 fine lines
  - Side of nose: 2–3 fine lines
  - Eye socket depth: 2–4 fine curved lines
- These lines should follow the CURVE OF THE SURFACE (not horizontal — they wrap around the face form)
- Keep hatching minimal — suggest shadow, do not fill it

═══════════════════════════════════════════════
STEP 6 — HAIR (realistic fine line rendering)
═══════════════════════════════════════════════
- Draw the outer hair silhouette first as a clean double-outlined shape
- Then fill with flowing lines that follow the actual direction of the hair:
  - 15–30 fine curved lines following the exact hair flow
  - Vary the spacing — closer together in darker areas, further apart in lighter areas
  - Lines should taper at the ends, not stop abruptly
  - Leave white space where highlights or shine appear

═══════════════════════════════════════════════
CRITICAL TECHNICAL RULES (FOR PHYSICAL PEN PLOTTER)
═══════════════════════════════════════════════
⚠️ MANDATORY — FAILURE TO FOLLOW WILL BREAK THE PLOTTER:

1. **COLOR REQUIREMENTS:**
   - ONLY pure black (#000000) lines on pure white (#FFFFFF) background
   - ZERO grey tones (no #808080, #CCCCCC, etc.)
   - ZERO transparency/alpha values
   - ZERO gradients or soft edges
   - ZERO solid fills (except small pupils)

2. **LINE REQUIREMENTS:**
   - All lines must be VECTOR PATHS (not raster/pixel fills)
   - Line weight: 0.5–0.6mm uniform stroke
   - Lines must be CONTINUOUS (no dashed or dotted lines)
   - Use MULTIPLE PARALLEL LINES for darker areas (not grey fills)

3. **SHADING TECHNIQUE (CRITICAL):**
   - Use CONTOUR HATCHING ONLY (lines follow surface curves)
   - 3–8 parallel lines for shadow areas
   - Lines must follow the form (wrap around face, not straight across)
   - Spacing: 0.5–1mm apart for shadows, 1–2mm apart for mid-tones
   - NO crosshatching grids
   - NO stippling or dots
   - NO solid black fills (except pupils)

4. **HAIR RENDERING:**
   - Draw 20–40 flowing lines following actual hair direction
   - Lines should be CURVED and ORGANIC (not straight)
   - Vary spacing: closer in dark areas, wider in light areas
   - Lines should taper naturally at ends
   - Leave white space for highlights

5. **FORBIDDEN ELEMENTS:**
   - NO grey fills or shading
   - NO pattern fills
   - NO blur effects
   - NO drop shadows
   - NO texture overlays
   - NO grid-based crosshatching

6. **IMAGE FORMAT:**
   - Aspect ratio: EXACTLY 9:10 portrait (900px × 1000px recommended)
   - Face should fill 75–85% of image height
   - Center the subject with equal margins
   - Clean white background — no paper texture

7. **QUALITY CHECKS:**
   - Zoom in to 400% — all lines should be crisp and clean
   - No stray pixels or artifacts
   - No overlapping duplicate lines
   - All lines should be traceable by a physical pen

8. **FINAL OUTPUT:**
   - Export as PNG with white background
   - No watermark, signature, border, or frame
   - File should be clean and ready for immediate plotter processing

Apply this portrait transformation to the attached photo now. Remember: a physical robot with a 0.6mm pen will trace every single line you draw.`;
