; Sovol SV02 Pen Plotter — Smiley Face Test
; Canvas: 200x160mm  Offset: X40 Y40
; Canvas center: X140 Y120
;
G21 ; mm units
G90 ; absolute positioning
G28 X Y ; home X and Y ONLY — never home Z
G0 Z3.000 F3000 ; pen up

; Face circle r=40 at (140,120)
G0 Z3.000 F3000 ; pen up before travel
G0 X180.000 Y120.000 F3000 ; travel to start
G0 Z0.000 F3000 ; pen down
G2 X180.000 Y120.000 I-40.000 J0.000 F1500 ; full circle CW
G0 Z3.000 F3000 ; pen up

; Left eye r=5 at (125,132)
G0 Z3.000 F3000 ; pen up before travel
G0 X130.000 Y132.000 F3000
G0 Z0.000 F3000 ; pen down
G2 X130.000 Y132.000 I-5.000 J0.000 F1500 ; full circle CW
G0 Z3.000 F3000 ; pen up

; Right eye r=5 at (155,132)
G0 Z3.000 F3000 ; pen up before travel
G0 X160.000 Y132.000 F3000
G0 Z0.000 F3000 ; pen down
G2 X160.000 Y132.000 I-5.000 J0.000 F1500 ; full circle CW
G0 Z3.000 F3000 ; pen up

; SMILE — G3 counter-clockwise arc from left to right
; Start: (122, 108)  End: (158, 108)
; Arc center: (140, 108) — center is ON the same Y as start/end
; I = 140-122 = 18,  J = 108-108 = 0
; G3 CCW with center to the right of start = curves upward at midpoint = SMILE
; Midpoint of arc will be at (140, 108 + 18) = (140, 126) — curves UP = happy
G0 Z3.000 F3000 ; pen up before travel
G0 X122.000 Y108.000 F3000 ; travel to smile start
G0 Z0.000 F3000 ; pen down
G3 X158.000 Y108.000 I18.000 J0.000 F1500 ; SMILE — CCW arc curves upward
G0 Z3.000 F3000 ; pen up

; Left eyebrow (slight upward tilt left to right)
G0 Z3.000 F3000 ; pen up before travel
G0 X117.000 Y142.000 F3000
G0 Z0.000 F3000 ; pen down
G1 X133.000 Y144.000 F1500
G0 Z3.000 F3000 ; pen up

; Right eyebrow
G0 Z3.000 F3000 ; pen up before travel
G0 X147.000 Y144.000 F3000
G0 Z0.000 F3000 ; pen down
G1 X163.000 Y142.000 F1500
G0 Z3.000 F3000 ; pen up

; === FOOTER ===
G0 Z8.000 F3000 ; raise pen safely
G0 X40.000 Y40.000 F3000 ; return to origin
M84 ; disable steppers
