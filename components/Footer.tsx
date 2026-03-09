export default function Footer() {
    return (
        <footer className="border-t border-slate-800 mt-auto">
            <div className="max-w-[1400px] mx-auto px-6 py-5 flex flex-col sm:flex-row items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-slate-500 text-sm">
                    <span>Warrane College</span>
                    <span className="text-slate-700">--</span>
                    <span>Reception:</span>
                    <a
                        href="tel:0293130300"
                        className="text-slate-400 hover:text-white transition-colors font-medium"
                    >
                        (02) 9313 0300
                    </a>
                </div>
                <p className="text-slate-600 text-xs">
                    Developed and Maintained by Warrane's residents
                </p>
            </div>
        </footer>
    );
}
