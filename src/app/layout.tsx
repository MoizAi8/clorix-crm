import type { Metadata } from "next";
import "@fontsource-variable/inter/wght.css";
import "@fontsource-variable/manrope";
import "@/app/globals.css";

export const metadata:Metadata={
  title:{default:"Clorix — From lead to loyalty.",template:"%s · Clorix"},
  description:"Track your sales pipeline, follow up with customers, and see where deals stand in one CRM workspace.",
  icons:{icon:"/brand/favicon.svg"},
};

export default function RootLayout({children}:{children:React.ReactNode}) {
  return <html lang="en"><body>{children}</body></html>;
}
