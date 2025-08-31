// src/app/page.tsx
// サーバコンポーネントをクライアントコンポーネトに（ブラウザで動くように）
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

// URL まずenv.localのNEXT_PUBLIC_API_BASE、なければhttp://127.0.0.1:8000にFB
const API = process.env.NEXT_PUBLIC_API_BASE ?? 'http://127.0.0.1:8000';

type Method = 'replace_face' | 'pixelate' | 'pixelate_strict' | 'blur' | 'box' | 'smart_blur';
type OutFmt = 'PNG' | 'JPEG';
type SecStatus = {                               // ← add
  current_level: string;
  external_api_enabled: boolean;
};


// （追加）APIのセキュリティ状態
type ApiSecurityStatus = {
  current_level?: string;
  external_api_enabled?: boolean; // false のときはオフライン等で外部API禁止
};

//　useState郡
export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [method, setMethod] = useState<Method>('replace_face');
  const [persona, setPersona] = useState('20代男性の笑顔');
  const [expand, setExpand] = useState(0.25);
  const [strength, setStrength] = useState(24);
  const [outFmt, setOutFmt] = useState<OutFmt>('PNG');

  const [outUrl, setOutUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [respMeta, setRespMeta] = useState<{ level?: string; detector?: string }>({});

  const prevUrlRef = useRef<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  // （追加）APIのセキュリティ状態
  const [apiStatus, setApiStatus] = useState<ApiSecurityStatus | null>(null);
  const allowGemini = !!apiStatus?.external_api_enabled; // true のときだけ replace_face を出す

  // objectURLのクリーンアップ
  useEffect(() => {
    return () => {
      if (prevUrlRef.current) URL.revokeObjectURL(prevUrlRef.current);
    };
  }, []);

  // （追加）起動時に /security/status を問い合わせて外部API可否を取得
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API}/security/status`, { cache: 'no-store' });
        if (res.ok) {
          const j = await res.json();
          setApiStatus({
            current_level: j.current_level,
            external_api_enabled: !!j.external_api_enabled,
          });
        } else {
          // 取得失敗時は安全側（外部API不可）に倒す
          setApiStatus({ current_level: 'unknown', external_api_enabled: false });
        }
      } catch {
        setApiStatus({ current_level: 'unknown', external_api_enabled: false });
      }
    })();
  }, []);

  // （追加）外部API不可のとき replace_face を強制的に外す
  useEffect(() => {
    if (!allowGemini && method === 'replace_face') {
      setMethod('pixelate');
      setMsg('オフラインモードのため Gemini は使用できません。pixelate に切り替えました。');
    }
  }, [allowGemini, method]);

  // （追加）メソッド選択肢を状況に応じて出し分け
  const availableMethods = useMemo<{ value: Method; label: string }[]>(
    () =>
      allowGemini
        ? [
          { value: 'replace_face', label: 'replace_face（Gemini）' },
          { value: 'pixelate', label: 'pixelate' },
          { value: 'pixelate_strict', label: 'pixelate_strict' },
          { value: 'blur', label: 'blur' },
          { value: 'smart_blur', label: 'smart_blur' },
          { value: 'box', label: 'box' },
        ]
        : [
          { value: 'pixelate', label: 'pixelate' },
          { value: 'pixelate_strict', label: 'smart pixelate（輪郭なし）' },
          { value: 'blur', label: 'blur' },
          { value: 'smart_blur', label: 'smart_blur' },
          { value: 'box', label: 'box' },
        ],
    [allowGemini]
  );

  // 実際の実行関数run
  async function run() {
    if (!file) return;
    if (file.size > 50 * 1024 * 1024) {
      setMsg('ファイルが大きすぎます（最大 50MB）');
      return;
    }
    if (method === 'replace_face' && !persona.trim()) {
      setMsg('ペルソナを入力してください'); return;
    }
    // （追加）保険：外部API不可の時は replace_face を拒否
    if (!allowGemini && method === 'replace_face') {
      setMsg('オフラインモードでは Gemini 機能は利用できません。別のメソッドを選択してください。');
      return;
    }

    // 進行中のリクエストがあれば中断
    controllerRef.current?.abort();
    const ac = new AbortController();
    controllerRef.current = ac;

    setBusy(true);
    setMsg(null);
    setOutUrl(null);
    setRespMeta({});

    try {
      const fd = new FormData();
      fd.append('file', file);

      const qs = new URLSearchParams({
        method,
        expand: String(expand),
        strength: String(strength),
        out_format: outFmt,          // ← 追加
      });
      if (method === 'replace_face') qs.set('persona', persona);

      const res = await fetch(`${API}/redact/face_image?${qs.toString()}`, {
        method: 'POST',
        body: fd,
        cache: 'no-store',
        signal: ac.signal,
      });

      if (!res.ok) {
        const t = await res.text().catch(() => '');
        setMsg(`HTTP ${res.status} ${res.statusText}${t ? ' — ' + t : ''}`);
        return;
      }

      // ヘッダからメタ情報
      setRespMeta({
        level: res.headers.get('x-security-level') ?? undefined,
        detector: res.headers.get('x-detection-method') ?? undefined,
      });

      const blob = await res.blob();

      // 古い URL を破棄してから新しい URL をセット
      if (prevUrlRef.current) URL.revokeObjectURL(prevUrlRef.current);
      const url = URL.createObjectURL(blob);
      prevUrlRef.current = url;
      setOutUrl(url);
      setMsg('完成！');
    } catch (e: any) {
      if (e?.name === 'AbortError') return; // 中断時は無視
      setMsg(String(e));
    } finally {
      setBusy(false);
    }
  }

  // 画面（JSX）　大体左が入力フォーム、右が出力（プレビュー）のイメージ
  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100">
      <div className="mx-auto max-w-3xl p-6 space-y-6">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold">FaceSwap Studio (nano-banana)</h1>
          {/* （追加）オフラインモードバッジ */}
          {apiStatus && !allowGemini && (
            <span className="text-xs rounded-full bg-amber-500/20 text-amber-300 px-3 py-1">
              オフラインモード（外部API無効）
            </span>
          )}
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {/* 左ペイン：設定 */}
          <div className="space-y-4 p-4 rounded-xl bg-neutral-900/60 border border-neutral-800">
            <label className="block text-sm font-medium">画像ファイル</label>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="block w-full rounded border border-neutral-700 bg-neutral-800 p-2"
            />

            <label className="block text-sm font-medium mt-4">メソッド</label>
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value as Method)}
              className="w-full rounded border border-neutral-700 bg-neutral-800 p-2"
            >
              {availableMethods.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>

            {method === 'replace_face' && allowGemini && (
              <>
                <label className="block text-sm font-medium mt-4">ペルソナ</label>
                <input
                  value={persona}
                  onChange={(e) => setPersona(e.target.value)}
                  className="w-full rounded border border-neutral-700 bg-neutral-800 p-2"
                  placeholder="30代女性の真顔 など"
                />
              </>
            )}

            <label className="block text-sm font-medium mt-4">
              expand ({expand.toFixed(2)})
            </label>
            <input
              type="range"
              min={0}
              max={0.5}
              step={0.01}
              value={expand}
              onChange={(e) => setExpand(parseFloat(e.target.value))}
              className="w-full"
            />

            {method !== 'box' && (
              <>
                <label className="block text-sm font-medium mt-4">
                  strength ({strength})
                </label>
                <input
                  type="range"
                  min={8}
                  max={80}
                  step={1}
                  value={strength}
                  onChange={(e) => setStrength(parseInt(e.target.value))}
                  className="w-full"
                />
              </>
            )}

            <label className="block text-sm font-medium mt-4">出力フォーマット</label>
            <select
              value={outFmt}
              onChange={(e) => setOutFmt(e.target.value as OutFmt)}
              className="w-full rounded border border-neutral-700 bg-neutral-800 p-2"
            >
              <option value="PNG">PNG</option>
              <option value="JPEG">JPEG</option>
            </select>

            <button
              onClick={run}
              disabled={!file || busy || (method === 'replace_face' && !persona.trim())}
              className="mt-6 w-full rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 px-4 py-2 font-medium"
            >
              {busy ? '生成中…' : '実行'}
            </button>

            {msg && <p className="text-sm text-neutral-300 mt-2">{msg}</p>}
            {(respMeta.level || respMeta.detector) && (
              <p className="text-xs text-neutral-400">
                {respMeta.level && <>Security: <code>{respMeta.level}</code> </>}
                {respMeta.detector && <>/ Detector: <code>{respMeta.detector}</code></>}
              </p>
            )}
          </div>

          {/* 右ペイン：プレビュー */}
          <div className="p-4 rounded-xl bg-neutral-900/60 border border-neutral-800">
            <div className="text-sm font-medium mb-2">プレビュー</div>
            <div className="aspect-square w-full overflow-hidden rounded-lg border border-neutral-800 bg-neutral-800/50 flex items-center justify-center">
              {outUrl ? (
                <img src={outUrl} alt="result" className="w-full h-full object-contain" />
              ) : (
                <div className="text-neutral-400 text-sm">ここに結果が出ます</div>
              )}
            </div>
            {outUrl && (
              <a
                href={outUrl}
                download={`faceswap.${outFmt.toLowerCase()}`}
                className="inline-block mt-3 text-sm underline text-emerald-400 hover:text-emerald-300"
              >
                ダウンロード
              </a>
            )}
          </div>
        </div>

        <p className="text-xs text-neutral-400">
          NEXT_PUBLIC_API_BASE: <code>{API}</code>
        </p>
      </div>
    </main>
  );
}
