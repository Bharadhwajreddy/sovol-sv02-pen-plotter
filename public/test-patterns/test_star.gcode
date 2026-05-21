; Sovol SV02 Pen Plotter — 5-Point Star
; Canvas: 200x160mm  Offset: X40 Y40
; Canvas center: X140 Y120
;
G21 ; mm units
G90 ; absolute positioning
G28 X Y ; home X and Y ONLY — never home Z
G0 Z3.000 F3000 ; pen up

; 5-point star: outer r=60, inner r=25, centered at (140,120)
; Points in order (CW from top):
;   i=0 outer  angle=-90:  (140.000,  60.000)
;   i=1 inner  angle=-54:  (154.702,  99.798)
;   i=2 outer  angle=-18:  (197.063, 101.459)
;   i=3 inner  angle= 18:  (163.776, 127.725)
;   i=4 outer  angle= 54:  (175.267, 168.541)
;   i=5 inner  angle= 90:  (140.000, 145.000)
;   i=6 outer  angle=126:  (104.733, 168.541)
;   i=7 inner  angle=162:  (116.224, 127.725)
;   i=8 outer  angle=198:  ( 82.937, 101.459)
;   i=9 inner  angle=234:  (125.298,  99.798)
;   close:                  (140.000,  60.000)

G0 X140.000 Y60.000 F3000
G0 Z0.000 F3000 ; pen down
G1 X154.702 Y99.798 F1500
G1 X197.063 Y101.459 F1500
G1 X163.776 Y127.725 F1500
G1 X175.267 Y168.541 F1500
G1 X140.000 Y145.000 F1500
G1 X104.733 Y168.541 F1500
G1 X116.224 Y127.725 F1500
G1 X82.937 Y101.459 F1500
G1 X125.298 Y99.798 F1500
G1 X140.000 Y60.000 F1500
G0 Z3.000 F3000 ; pen up

; === FOOTER ===
G0 Z8.000 F3000 ; raise pen safely
G0 X40.000 Y40.000 F3000 ; return to origin
M84 ; disable steppers
