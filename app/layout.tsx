import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Sovol SV02 Pen Plotter",
  description:
    "Convert sketch images into G-code for the Sovol SV02 pen plotter",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-[#0f0f0f] text-gray-100 antialiased">
        {children}
      </body>
    </html>
  );
}
