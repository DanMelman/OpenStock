/**
 * MelmanStock wordmark: a small rising-bars mark and the name in the app font,
 * drawn in the brand colour so it follows the palette in globals.css.
 */
export default function BrandLogo({ size = 'md' }: { size?: 'sm' | 'md' }) {
    const text = size === 'sm' ? 'text-[17px]' : 'text-[20px]';
    const mark = size === 'sm' ? 22 : 26;
    return (
        <span className="inline-flex items-center gap-2 select-none" aria-label="MelmanStock">
            <svg width={mark} height={mark} viewBox="0 0 26 26" aria-hidden="true">
                <rect x="0.5" y="0.5" width="25" height="25" rx="7" fill="var(--brand-soft)" stroke="var(--brand)" strokeOpacity="0.5" />
                <rect x="6" y="14" width="3.2" height="6" rx="1.2" fill="var(--brand)" />
                <rect x="11.4" y="10" width="3.2" height="10" rx="1.2" fill="var(--brand)" />
                <rect x="16.8" y="6" width="3.2" height="14" rx="1.2" fill="var(--brand-ink)" />
            </svg>
            <span className={`${text} font-bold tracking-tight text-foreground`}>
                <span className="text-brand-ink">Melman</span>Stock
            </span>
        </span>
    );
}
