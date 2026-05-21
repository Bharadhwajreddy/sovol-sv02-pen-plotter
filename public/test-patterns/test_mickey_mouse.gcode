; Sovol SV02 Pen Plotter — Mickey Mouse
; Canvas: 200x160mm  Offset: X40 Y40
; Canvas center: X140 Y120
;
G21 ; mm units
G90 ; absolute positioning
G28 X Y ; home X and Y ONLY — never home Z
G0 Z3.000 F3000 ; pen up

; Head r=32 at (140,112)
G0 X172.000 Y112.000 F3000
G0 Z0.000 F3000 ; pen down
G2 X172.000 Y112.000 I-32.000 J0.000 F1500 ; full circle
G0 Z3.000 F3000 ; pen up

; Left ear r=20 at (112,136)
G0 X132.000 Y136.000 F3000
G0 Z0.000 F3000 ; pen down
G2 X132.000 Y136.000 I-20.000 J0.000 F1500 ; full circle
G0 Z3.000 F3000 ; pen up

; Right ear r=20 at (168,136)
G0 X188.000 Y136.000 F3000
G0 Z0.000 F3000 ; pen down
G2 X188.000 Y136.000 I-20.000 J0.000 F1500 ; full circle
G0 Z3.000 F3000 ; pen up

; Left eye r=6 at (129,112)
G0 X135.000 Y112.000 F3000
G0 Z0.000 F3000 ; pen down
G2 X135.000 Y112.000 I-6.000 J0.000 F1500 ; full circle
G0 Z3.000 F3000 ; pen up

; Right eye r=6 at (151,112)
G0 X157.000 Y112.000 F3000
G0 Z0.000 F3000 ; pen down
G2 X157.000 Y112.000 I-6.000 J0.000 F1500 ; full circle
G0 Z3.000 F3000 ; pen up

; Nose r=5 at (140,100)
G0 X145.000 Y100.000 F3000
G0 Z0.000 F3000 ; pen down
G2 X145.000 Y100.000 I-5.000 J0.000 F1500 ; full circle
G0 Z3.000 F3000 ; pen up

; Smile
G0 X122.000 Y94.000 F3000
G0 Z0.000 F3000 ; pen down
G2 X158.000 Y94.000 I18.000 J-12.000 F1500 ; smile
G0 Z3.000 F3000 ; pen up

; === FOOTER ===
G0 Z8.000 F3000 ; raise pen safely
G0 X40.000 Y40.000 F3000 ; return to origin
M84 ; disable steppers
