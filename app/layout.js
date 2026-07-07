export const metadata = {
  title: "freee 取引エージェント",
  description: "未処理明細を自動でルール化し、確定申告を楽にする",
};

export default function RootLayout({ children }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
