; Sovol SV02 Pen Plotter — Z-Hop Test
; Canvas: 200x160mm  Offset: X40 Y40
; Canvas center: X140 Y120
;
G21 ; mm units
G90 ; absolute positioning
G28 X Y ; home X and Y ONLY — never home Z
G0 Z3.000 F3000 ; pen up

; 10 vertical lines centered on canvas
; startX = 140 - 9*15/2 = 72.5, spacing = 15mm

; Line 1 at x=72.5
G0 X72.500 Y110.000 F3000
G0 Z0.000 F3000 ; pen down
G1 X72.500 Y130.000 F1500
G0 Z3.000 F3000 ; pen up

; Line 2 at x=87.5
G0 X87.500 Y110.000 F3000
G0 Z0.000 F3000 ; pen down
G1 X87.500 Y130.000 F1500
G0 Z3.000 F3000 ; pen up

; Line 3 at x=102.5
G0 X102.500 Y110.000 F3000
G0 Z0.000 F3000 ; pen down
G1 X102.500 Y130.000 F1500
G0 Z3.000 F3000 ; pen up

; Line 4 at x=117.5
G0 X117.500 Y110.000 F3000
G0 Z0.000 F3000 ; pen down
G1 X117.500 Y130.000 F1500
G0 Z3.000 F3000 ; pen up

; Line 5 at x=132.5
G0 X132.500 Y110.000 F3000
G0 Z0.000 F3000 ; pen down
G1 X132.500 Y130.000 F1500
G0 Z3.000 F3000 ; pen up

; Line 6 at x=147.5
G0 X147.500 Y110.000 F3000
G0 Z0.000 F3000 ; pen down
G1 X147.500 Y130.000 F1500
G0 Z3.000 F3000 ; pen up

; Line 7 at x=162.5
G0 X162.500 Y110.000 F3000
G0 Z0.000 F3000 ; pen down
G1 X162.500 Y130.000 F1500
G0 Z3.000 F3000 ; pen up

; Line 8 at x=177.5
G0 X177.500 Y110.000 F3000
G0 Z0.000 F3000 ; pen down
G1 X177.500 Y130.000 F1500
G0 Z3.000 F3000 ; pen up

; Line 9 at x=192.5
G0 X192.500 Y110.000 F3000
G0 Z0.000 F3000 ; pen down
G1 X192.500 Y130.000 F1500
G0 Z3.000 F3000 ; pen up

; Line 10 at x=207.5
G0 X207.500 Y110.000 F3000
G0 Z0.000 F3000 ; pen down
G1 X207.500 Y130.000 F1500
G0 Z3.000 F3000 ; pen up

; === FOOTER ===
G0 Z8.000 F3000 ; raise pen safely
G0 X40.000 Y40.000 F3000 ; return to origin
M84 ; disable steppers
