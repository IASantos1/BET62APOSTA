type BrandMarkProps = {
  size?: number;
  rounded?: 'circle' | 'soft';
  className?: string;
  label?: string;
};

export function BrandMark({
  size = 56,
  rounded = 'circle',
  className = '',
  label = '62',
}: BrandMarkProps) {
  const radius = rounded === 'circle' ? '9999px' : '24px';

  return (
    <div
      className={`relative inline-flex items-center justify-center bg-gradient-to-br from-red-500 via-red-600 to-rose-700 text-white shadow-lg ${className}`}
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        boxShadow: '0 16px 32px rgba(200,16,46,0.22)',
      }}
    >
      <span
        className="relative z-10 font-black tracking-[-0.06em]"
        style={{ fontSize: Math.max(16, Math.round(size * 0.42)) }}
      >
        {label}
      </span>
      <span
        className="absolute inset-[8%] rounded-[inherit] opacity-20"
        style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.3), transparent 60%)' }}
      />
    </div>
  );
}
