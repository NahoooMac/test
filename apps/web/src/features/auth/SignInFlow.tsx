import { useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import type { CurrentUser, OtpChallenge } from '@dp/shared';
import { sessionQueryKey, useSession } from '../../lib/session.tsx';
import { CodeStep } from './CodeStep.tsx';
import { PhoneStep } from './PhoneSignIn.tsx';
import { ProfileStep } from './ProfileStep.tsx';

type Step =
  | { name: 'phone' }
  | { name: 'code'; challenge: OtpChallenge; phoneInput: string }
  | { name: 'profile' };

/**
 * Phone → code → (first time only) name. Each surface supplies its own layout and phone-step intro;
 * the flow supplies the headings for later steps so wording stays consistent.
 */
export function SignInFlow({
  homePath,
  intro,
  layout,
  submitSize = 'lg',
}: {
  homePath: string;
  intro: ReactNode;
  layout: (heading: ReactNode, form: ReactNode) => ReactNode;
  submitSize?: 'md' | 'lg';
}) {
  const { t } = useTranslation();
  const session = useSession();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const [step, setStep] = useState<Step>({ name: 'phone' });
  const [phoneInput, setPhoneInput] = useState('');

  const from = (location.state as { from?: string } | null)?.from;
  const finish = (user: CurrentUser) => {
    queryClient.setQueryData(sessionQueryKey, user);
    navigate(from && from.startsWith(homePath) ? from : homePath, { replace: true });
  };

  // Already signed in (session restored from the cookie): no reason to be here.
  if (step.name === 'phone' && session.data) return <Navigate to={homePath} replace />;

  if (step.name === 'code') {
    return layout(
      <StepHeading
        title={t('auth.code.title')}
        // Non-breaking spaces keep the masked number on one line.
        body={t('auth.code.sentTo', { phone: step.challenge.maskedPhone.replace(/ /g, '\u00a0') })}
      />,
      <CodeStep
        key={step.challenge.challengeId}
        challenge={step.challenge}
        phoneInput={step.phoneInput}
        submitSize={submitSize}
        onChangeNumber={() => setStep({ name: 'phone' })}
        onResent={(challenge) => setStep({ ...step, challenge })}
        onVerified={(r) => {
          queryClient.setQueryData(sessionQueryKey, r.user);
          if (r.needsProfile) setStep({ name: 'profile' });
          else finish(r.user);
        }}
      />,
    );
  }

  if (step.name === 'profile') {
    return layout(
      <StepHeading title={t('auth.profile.title')} body={t('auth.profile.subtitle')} />,
      <ProfileStep submitSize={submitSize} onSaved={finish} />,
    );
  }

  return layout(
    intro,
    <PhoneStep
      initialPhone={phoneInput}
      submitSize={submitSize}
      onSent={(challenge, input) => {
        setPhoneInput(input);
        setStep({ name: 'code', challenge, phoneInput: input });
      }}
    />,
  );
}

function StepHeading({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <h1 className="text-[28px] leading-tight font-bold tracking-tight">{title}</h1>
      <p className="mt-2 text-base text-ink-2 tabular">{body}</p>
    </div>
  );
}
