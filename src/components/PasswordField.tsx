import { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'

export function PasswordField(props: {
  value: string
  placeholder: string
  onChange: (value: string) => void
  onEnter?: () => void
}) {
  const { value, placeholder, onChange, onEnter } = props
  const [revealed, setRevealed] = useState(false)

  return (
    <div className='password-field'>
      <input
        type={revealed ? 'text' : 'password'}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && onEnter) {
            event.preventDefault()
            onEnter()
          }
        }}
        placeholder={placeholder}
      />
      <button
        className='password-toggle'
        type='button'
        aria-label={revealed ? '松开隐藏密码' : '按住查看密码'}
        onPointerDown={(event) => {
          event.preventDefault()
          setRevealed(true)
        }}
        onPointerUp={() => setRevealed(false)}
        onPointerLeave={() => setRevealed(false)}
        onPointerCancel={() => setRevealed(false)}
        onKeyDown={(event) => {
          if (event.key === ' ' || event.key === 'Enter') {
            event.preventDefault()
            setRevealed(true)
          }
        }}
        onKeyUp={() => setRevealed(false)}
        onBlur={() => setRevealed(false)}
      >
        {revealed ? <Eye size={16} /> : <EyeOff size={16} />}
      </button>
    </div>
  )
}
