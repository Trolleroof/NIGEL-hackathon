import type { Metadata } from "next"
import { Orbitron, Space_Mono } from "next/font/google"
import "./globals.css"

const orbitron = Orbitron({
  subsets: ["latin"],
  weight: ["400", "500", "700", "900"],
  variable: "--font-orbitron",
})

const spaceMono = Space_Mono({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-space-mono",
})

export const metadata: Metadata = {
  title: "NIGEL",
  description: "Navigation, Incident Guidance, and Emergency Localization & Control",
}

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${orbitron.variable} ${spaceMono.variable}`}>
        {children}
      </body>
    </html>
  )
}
