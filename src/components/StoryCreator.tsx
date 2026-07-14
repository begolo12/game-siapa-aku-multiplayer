import React, { useState, useEffect } from "react";
import { StoryTemplate, User } from "../types";
import { ChevronRight, ChevronLeft, Send, Sparkles, BookOpen, AlertCircle, CheckCircle2, Lock, Shield } from "lucide-react";

interface StoryCreatorProps {
  currentUser: User | null;
  onSubmitStory: (templateId: string, blanks: string[], answer: string) => Promise<void>;
  userStoryCount: number;
  userTemplateIds: string[];
}

export default function StoryCreator({ currentUser, onSubmitStory, userStoryCount, userTemplateIds }: StoryCreatorProps) {
  const [templates, setTemplates] = useState<StoryTemplate[]>([]);
  const [templateBlanks, setTemplateBlanks] = useState<Record<string, string[]>>({});
  const [wizardStep, setWizardStep] = useState<1 | 2>(1);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [submitProgress, setSubmitProgress] = useState<string | null>(null);

  // Fetch templates from API on mount
  useEffect(() => {
    fetch("/api/templates")
      .then((res) => res.json())
      .then((data: StoryTemplate[]) => {
        setTemplates(data);
        // Initialize blanks for each template
        const blanksMap: Record<string, string[]> = {};
        data.forEach((t) => {
          blanksMap[t.id] = Array(t.placeholders.length).fill("");
        });
        setTemplateBlanks(blanksMap);
      })
      .catch((err) => console.error("Error fetching templates:", err));
  }, []);

  // Which templates still need stories
  const neededTemplates = templates.filter((t) => !userTemplateIds.includes(t.id));

  const handleBlankChange = (templateId: string, index: number, val: string) => {
    setTemplateBlanks((prev) => {
      const current = prev[templateId] ? [...prev[templateId]] : [];
      while (current.length <= index) current.push("");
      current[index] = val;
      return { ...prev, [templateId]: current };
    });
    if (error) setError(null);
  };

  const validateWizard1 = () => {
    // Check all needed templates have all blanks filled
    for (const t of neededTemplates) {
      const blanks = templateBlanks[t.id] || [];
      const emptyCount = blanks.filter((b) => !b || !b.trim()).length;
      if (emptyCount > 0) {
        setError(`Template "${t.title}" masih ada ${emptyCount} kolom kosong. Harap isi seluruh ${t.placeholders.length} kolom.`);
        return false;
      }
    }
    setError(null);
    return true;
  };

  const handleNextToWizard2 = () => {
    if (validateWizard1()) {
      setWizardStep(2);
    }
  };

  const compileStoryPreview = (template: StoryTemplate) => {
    const blanks = templateBlanks[template.id] || [];
    let compiled = "";
    template.parts.forEach((part, idx) => {
      compiled += part;
      if (idx < blanks.length) {
        const val = (blanks[idx] || "").trim();
        compiled += val ? `"${val}"` : `[Isian ${idx + 1}]`;
      }
    });
    return compiled;
  };

  const handlePublishAll = async () => {
    if (!currentUser?.username) {
      setError("Username tidak ditemukan. Harap login ulang.");
      return;
    }
    setIsLoading(true);
    setError(null);

    try {
      for (const t of neededTemplates) {
        setSubmitProgress(`Mempublikasikan: ${t.title}...`);
        const blanks = (templateBlanks[t.id] || []).map((b) => b.trim());
        await onSubmitStory(t.id, blanks, currentUser.username);
      }
      setSubmitProgress(null);
      setIsSuccess(true);
    } catch (err: any) {
      setError(err.message || "Gagal menyimpan cerita.");
      setSubmitProgress(null);
    } finally {
      setIsLoading(false);
    }
  };

  const totalBlanks = neededTemplates.reduce((sum, t) => sum + t.placeholders.length, 0);
  const filledBlanks = neededTemplates.reduce((sum, t) => {
    const blanks = templateBlanks[t.id] || [];
    return sum + blanks.filter((b) => b && b.trim()).length;
  }, 0);

  // SUCCESS / ALREADY DONE
  if (isSuccess || userStoryCount >= 2) {
    return (
      <div className="bg-[#2b241c]/80 backdrop-blur-md rounded-2xl border border-slate-800/80 p-8 shadow-xl text-center max-w-xl mx-auto my-6 animate-slideUp relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-emerald-500/5 to-transparent pointer-events-none" />
        <div className="mx-auto flex items-center justify-center h-16 w-16 rounded-full bg-emerald-500/10 border border-emerald-500/20 mb-6 relative">
          <CheckCircle2 className="h-10 w-10 text-emerald-400" />
        </div>
        <h3 className="text-2xl font-bold text-white mb-2 relative">2 Cerita Berhasil Dipublikasikan!</h3>
        <p className="text-slate-400 mb-6 text-sm leading-relaxed relative">
          {currentUser?.isAdmin
            ? "Kedua teka-teki cerita telah dipublikasikan. Anda bisa mulai sesi permainan dari Panel Admin."
            : "Kedua teka-teki cerita Anda telah dimasukkan ke dalam daftar tebakan aktif."}
        </p>
        <div className="bg-emerald-950/20 border border-emerald-500/20 text-emerald-300 font-semibold text-sm py-3 px-4 rounded-xl flex items-center justify-center gap-2 relative">
          <CheckCircle2 className="w-4 h-4" />
          Cerita Lengkap: 2/2 — Siap Bermain!
        </div>
      </div>
    );
  }

  return (
    <div className="bg-[#2b241c]/80 backdrop-blur-md rounded-2xl border border-slate-800 p-6 shadow-xl animate-fadeIn">
      {/* Submission Status Banner */}
      {currentUser?.isAdmin ? (
        <div className="mb-5 p-3 rounded-xl flex items-center justify-between text-sm border bg-blue-950/30 border-blue-800/40 text-blue-300">
          <span className="flex items-center gap-2 font-semibold">
            <Shield className="w-4 h-4" />
            Mode Admin — Cerita bersifat opsional
          </span>
          <span className="text-xs text-blue-400">{userStoryCount}/2 cerita dibuat</span>
        </div>
      ) : (
        <div className="mb-5 p-3 rounded-xl flex items-center justify-between text-sm border bg-amber-950/30 border-amber-800/40 text-amber-300">
          <span className="flex items-center gap-2 font-semibold">
            <AlertCircle className="w-4 h-4" />
            Cerita Anda: {userStoryCount}/2
          </span>
          <span className="text-xs text-amber-400">Buat {2 - userStoryCount} cerita lagi</span>
        </div>
      )}

      {/* Wizard Header Progress */}
      <div className="flex flex-col sm:flex-row gap-4 sm:items-center justify-between mb-8 border-b border-slate-850 pb-5">
        <div>
          <h2 className="text-lg font-bold text-white flex items-center gap-2 uppercase tracking-wider">
            <Sparkles className="w-5 h-5 text-pink-400" /> Buat Teka-Teki Cerita
          </h2>
          <p className="text-xs text-slate-400">Isi kedua template, lalu review sebelum publikasi.</p>
        </div>
        <div className="flex items-center space-x-2">
          <div className="flex items-center">
            <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border ${wizardStep === 1 ? "bg-pink-500 text-white border-pink-500" : "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"}`}>
              1
            </span>
            <span className="text-xs ml-1.5 font-bold text-slate-300">Isi Cerita</span>
          </div>
          <ChevronRight className="w-4 h-4 text-slate-600" />
          <div className="flex items-center">
            <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border ${wizardStep === 2 ? "bg-pink-500 text-white border-pink-500" : "bg-slate-900 text-slate-500 border-slate-800"}`}>
              2
            </span>
            <span className="text-xs ml-1.5 font-bold text-slate-300">Review & Publikasi</span>
          </div>
        </div>
      </div>

      {error && (
        <div className="mb-5 bg-rose-950/50 border border-rose-900/50 text-rose-200 p-4 rounded-xl flex items-start gap-2 text-sm animate-fadeIn">
          <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {submitProgress && (
        <div className="mb-5 bg-blue-950/50 border border-blue-900/50 text-blue-200 p-4 rounded-xl flex items-center gap-2 text-sm animate-fadeIn">
          <Send className="w-4 h-4 text-blue-400 shrink-0 animate-pulse" />
          <span>{submitProgress}</span>
        </div>
      )}

      {/* STEP 1: FILL BOTH TEMPLATES */}
      {wizardStep === 1 && (
        <div className="space-y-6">
          {/* Progress */}
          <div className="flex items-center justify-between text-xs text-slate-400 font-mono">
            <span>Progress Mengisi:</span>
            <span className="text-pink-400 font-bold">{filledBlanks}/{totalBlanks} Kolom Terisi</span>
          </div>
          <div className="w-full bg-slate-800 rounded-full h-2 mb-4">
            <div className="bg-gradient-to-r from-pink-500 to-purple-600 h-2 rounded-full transition-all duration-300" style={{ width: `${totalBlanks > 0 ? (filledBlanks / totalBlanks) * 100 : 0}%` }} />
          </div>

          {/* Templates side by side */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {neededTemplates.map((template) => {
              const blanks = templateBlanks[template.id] || [];
              const filled = blanks.filter((b) => b && b.trim()).length;
              const allFilled = filled === template.placeholders.length;
              return (
                <div key={template.id} className={`rounded-2xl border p-5 transition-all ${allFilled ? "bg-emerald-950/10 border-emerald-500/20" : "bg-[#1a150f]/40 border-slate-800"}`}>
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <BookOpen className="w-4 h-4 text-pink-400" />
                      <h3 className="text-sm font-bold text-white">{template.title}</h3>
                    </div>
                    <span className={`text-[10px] font-bold px-2 py-1 rounded-full ${allFilled ? "bg-emerald-500/20 text-emerald-400" : "bg-amber-500/20 text-amber-400"}`}>
                      {filled}/{template.placeholders.length} {allFilled ? "✓" : ""}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {template.placeholders.map((ph, idx) => (
                      <div key={idx} className="flex flex-col">
                        <label className="text-[10px] font-bold text-slate-400 mb-1 flex items-center gap-1 font-mono">
                          <span className="bg-pink-500/10 border border-pink-500/20 text-pink-300 w-4 h-4 rounded-full flex items-center justify-center text-[10px] shrink-0 font-bold">
                            {idx + 1}
                          </span>
                          {ph.split(" (")[0]}
                        </label>
                        <input
                          type="text"
                          placeholder={ph.includes("(") ? ph.substring(ph.indexOf("(")) : ""}
                          value={(blanks[idx] || "")}
                          onChange={(e) => handleBlankChange(template.id, idx, e.target.value)}
                          className="text-sm bg-[#1a150f]/80 border border-slate-800 rounded-xl px-3 py-2 text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-pink-500 focus:bg-[#1a150f]"
                        />
                      </div>
                    ))}
                  </div>
                  {/* Mini preview */}
                  <div className="mt-4 p-3 bg-slate-900/50 rounded-xl text-xs text-slate-300 leading-relaxed italic border border-slate-800/50">
                    "{compileStoryPreview(template)}"
                  </div>
                </div>
              );
            })}
          </div>

          {/* Wizard Actions */}
          <div className="flex justify-end pt-4 border-t border-slate-800/80">
            <button
              onClick={handleNextToWizard2}
              className="bg-gradient-to-r from-pink-500 via-purple-600 to-indigo-600 hover:from-pink-600 hover:via-purple-700 hover:to-indigo-700 text-white font-bold text-sm px-6 py-3 rounded-xl flex items-center gap-1.5 transition-all shadow-lg shadow-pink-500/15 cursor-pointer"
            >
              Lanjut ke Review <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* STEP 2: REVIEW & PUBLISH BOTH */}
      {wizardStep === 2 && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {neededTemplates.map((template) => (
              <div key={template.id} className="bg-[#1a150f]/60 p-4 border border-slate-800 rounded-2xl">
                <h3 className="text-[10px] font-bold text-pink-400 uppercase tracking-wider mb-2 font-mono flex items-center gap-1.5">
                  <BookOpen className="w-3 h-3" />
                  {template.title}
                </h3>
                <p className="text-slate-200 text-sm leading-relaxed italic">
                  "{compileStoryPreview(template)}"
                </p>
              </div>
            ))}
          </div>

          {/* Answer section */}
          <div className="max-w-md mx-auto space-y-4 py-4">
            <div className="text-center">
              <label className="block text-lg font-bold text-white mb-1 uppercase tracking-wide">
                NAMA / Karakter Jawaban
              </label>
              <p className="text-xs text-slate-400 mb-4">
                Jawaban otomatis memakai nama depan Anda. Pemain lain memilihnya melalui autocomplete.
              </p>
            </div>
            <div className="relative">
              <div className="w-full text-center text-lg font-bold bg-[#1a150f] border-2 border-solid border-emerald-500/40 text-emerald-300 rounded-2xl px-4 py-3.5 flex items-center justify-center gap-2">
                <Lock className="w-4 h-4 text-emerald-400" />
                {currentUser?.username.trim().split(/\s+/)[0]}
              </div>
              <p className="text-[10px] text-slate-500 mt-2 text-center font-mono">
                Terkunci otomatis · pembuat cerita = jawaban
              </p>
            </div>

            <button
              onClick={() => setWizardStep(1)}
              className="bg-slate-900 border border-slate-800 text-slate-300 font-bold text-sm px-5 py-2.5 rounded-xl flex items-center gap-1.5 transition-all cursor-pointer hover:bg-slate-800"
            >
              <ChevronLeft className="w-4 h-4" /> Kembali
            </button>

            <button
              onClick={handlePublishAll}
              disabled={isLoading}
              className="w-full bg-gradient-to-r from-pink-500 via-purple-600 to-indigo-600 hover:from-pink-600 hover:via-purple-700 hover:to-indigo-700 disabled:from-slate-800 disabled:to-slate-800 disabled:cursor-not-allowed text-white font-bold text-sm px-6 py-3 rounded-xl flex items-center justify-center gap-1.5 transition-all shadow-lg shadow-pink-500/15 cursor-pointer"
            >
              {isLoading ? "Mengunggah..." : `Publikasikan ${neededTemplates.length} Cerita`} <Send className="w-3.5 h-3.5 text-yellow-300 animate-pulse" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
