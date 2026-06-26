import './App.css';

function App() {
  return (
    <main className="popup">
      <div>
        <p className="eyebrow">Google Drive用</p>
        <h1>Drive Retouch</h1>
        <p className="description">
          Driveの画像プレビュー上で「レタッチ」ボタンを押すと、補正パネルを表示します。
        </p>
      </div>

      <div className="status">
        <span className="dot" />
        プレビュー専用です。元画像は保存・変更されません。
      </div>
    </main>
  );
}

export default App;
