import React, { useState, useEffect } from 'react';
import {
  X,
  Lock,
  Phone,
  User,
  KeyRound,
  LogIn,
  LogOut,
  Eye,
  EyeOff,
  AlertCircle,
  Check,
  ShieldCheck,
  ArrowLeft,
  CheckCircle2,
  Mail,
  MessageCircle,
  Copy,
  UserPlus,
  MapPin,
} from 'lucide-react';
import type { AppUser, Customer, LoginFormConfig, Reseller, UserAccount, UserRole } from '../types/index.ts';
import {
  defaultGuestUser,
  getLoginFormConfig,
  logUserLogin,
  apiAuthenticateLogin,
  apiRegisterCustomer,
  apiChangeOwnPassword,
  apiChangeMasterPin,
} from '../utils/storage.ts';
import { getCurrentOrigin, openWhatsAppDirect } from '../utils/whatsapp.ts';

function normalizePhoneOrId(val: string): string {
  const clean = val.trim().replace(/[\s-]/g, '');
  if (clean.startsWith('+92') && clean.length >= 12) {
    return `0${clean.slice(3)}`;
  }
  if (clean.startsWith('92') && clean.length >= 11 && !clean.startsWith('920')) {
    return `0${clean.slice(2)}`;
  }
  return clean;
}

type ModalMode =
  | 'login'
  | 'register'
  | 'registration_confirmation'
  | 'account'
  | 'forgot_password'
  | 'force_change_password';

interface RegistrationConfirmationState {
  fullName: string;
  phone: string;
  whatsappNumber: string;
  email?: string;
  temporaryPassword: string;
  user: Partial<AppUser> & { role: UserRole };
}

interface LoginRoleModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: AppUser;
  onSelectRole: (role: UserRole, userDetails?: Partial<AppUser>) => void;
  customers?: Customer[];
  resellers?: Reseller[];
  onLogout?: () => void;
}

export const LoginRoleModal: React.FC<LoginRoleModalProps> = ({
  isOpen,
  onClose,
  currentUser,
  onSelectRole,
  onLogout,
}) => {
  const isGuest = currentUser?.isAuthenticated !== true;

  const [modalMode, setModalMode] = useState<ModalMode>(isGuest ? 'login' : 'account');
  const [loginConfig, setLoginConfig] = useState<LoginFormConfig>(getLoginFormConfig);

  // Unified Sign-In Inputs
  const [identifier, setIdentifier] = useState('');
  const [pin, setPin] = useState('');
  const [rememberMe, setRememberMe] = useState(true);
  const [showPin, setShowPin] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  // Customer Self-Registration Inputs
  const [regName, setRegName] = useState('');
  const [regPhone, setRegPhone] = useState('');
  const [regWhatsappSameAsPhone, setRegWhatsappSameAsPhone] = useState(true);
  const [regWhatsapp, setRegWhatsapp] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regCity, setRegCity] = useState('Muzaffarabad');
  const [isRegistering, setIsRegistering] = useState(false);
  const [regError, setRegError] = useState('');

  // Post-Registration Confirmation & Temporary Password Delivery
  const [regConfirmation, setRegConfirmation] = useState<RegistrationConfirmationState | null>(null);
  const [showTempPassword, setShowTempPassword] = useState(true);
  const [copiedTempPass, setCopiedTempPass] = useState(false);
  const [whatsappSentDone, setWhatsappSentDone] = useState(false);
  const [emailOpenedDone, setEmailOpenedDone] = useState(false);

  // Mandatory / Forced Password Change
  const [pendingUserAccount, setPendingUserAccount] = useState<UserAccount | null>(null);
  const [pendingCurrentPin, setPendingCurrentPin] = useState('');
  const [forcedNewPass, setForcedNewPass] = useState('');
  const [forcedConfirmPass, setForcedConfirmPass] = useState('');
  const [forcePassError, setForcePassError] = useState('');

  // Forgot Password / Support Helpline State
  const [forgotIdentifier, setForgotIdentifier] = useState('');
  const [forgotError, setForgotError] = useState('');
  const [forgotSuccess, setForgotSuccess] = useState('');

  // Change Password inside Account Portal
  const [currentPinInput, setCurrentPinInput] = useState('');
  const [newPinInput, setNewPinInput] = useState('');
  const [confirmPinInput, setConfirmPinInput] = useState('');
  const [changePinError, setChangePinError] = useState('');
  const [changePinSuccess, setChangePinSuccess] = useState('');

  useEffect(() => {
    if (isOpen) {
      setErrorMessage('');
      setSuccessMessage('');
      setRegError('');
      setChangePinError('');
      setChangePinSuccess('');
      setForgotError('');
      setForgotSuccess('');
      setForcePassError('');
      setCurrentPinInput('');
      setNewPinInput('');
      setConfirmPinInput('');
      setCopiedTempPass(false);
      setWhatsappSentDone(false);
      setEmailOpenedDone(false);
      setLoginConfig(getLoginFormConfig());

      if (currentUser?.isAuthenticated === true) {
        setModalMode('account');
      } else {
        setModalMode('login');
      }
    }
  }, [isOpen, currentUser?.isAuthenticated]);

  if (!isOpen) return null;

  const supportNumber = loginConfig.supportContactNumber || '03125256266';

  const handleOpenSupport = (contextNote?: string) => {
    const text =
      contextNote ||
      'السلام علیکم! مجھے 100DAGAR اکاؤنٹ میں لاگ ان، رجسٹریشن یا پاس ورڈ میں مدد چاہیے۔ شکریہ!';
    openWhatsAppDirect(supportNumber, text);
  };

  // SERVER-AUTHORITATIVE SIGN-IN HANDLER
  const handleCombinedLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');
    setSuccessMessage('');

    const cleanId = normalizePhoneOrId(identifier);
    const cleanPin = pin.trim();

    if (!cleanId) {
      setErrorMessage('Please enter your mobile number, email, or username.');
      return;
    }

    if (!cleanPin || cleanPin.length < 4) {
      setErrorMessage('Please enter your valid password / PIN (min 4 characters).');
      return;
    }

    setIsLoggingIn(true);
    const serverAuth = await apiAuthenticateLogin(identifier.trim(), cleanPin);
    setIsLoggingIn(false);

    if (serverAuth.ok && serverAuth.user) {
      const authUser = serverAuth.user as Partial<AppUser> & { role: UserRole };
      if (authUser.mustChangePassword === true) {
        setPendingUserAccount({
          id: authUser.id || `usr_${Date.now()}`,
          username: cleanId,
          fullName: authUser.name || 'User',
          urduName: authUser.urduName,
          phone: authUser.phone || cleanId,
          whatsapp: authUser.whatsapp,
          whatsappSameAsPhone: authUser.whatsappSameAsPhone,
          email: authUser.email,
          role: authUser.role,
          status: 'active',
          linkedCustomerId: authUser.customerId,
          linkedInvestorId: authUser.investorId,
          linkedResellerCode: authUser.resellerCode,
          linkedBranchId: authUser.branchId,
          linkedBranchName: authUser.branchName,
          managerAuthorities: authUser.managerAuthorities,
          crmRole: authUser.crmRole,
          crmPermissions: authUser.crmPermissions,
          canAuthorizeCreditSale: authUser.canAuthorizeCreditSale,
          mustChangePassword: true,
          createdAt: new Date().toISOString(),
        });
        setPendingCurrentPin(cleanPin);
        setModalMode('force_change_password');
        return;
      }

      onSelectRole(authUser.role, {
        ...authUser,
        isAuthenticated: true,
      });
      onClose();
      return;
    }

    setErrorMessage(
      serverAuth.error ||
        'Invalid credentials. Please check your mobile number / email / username and password, or register a new account.'
    );
  };

  // EXPLICIT CUSTOMER SELF-REGISTRATION HANDLER
  const handleCustomerRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setRegError('');

    const cleanName = regName.trim();
    const cleanPhone = regPhone.trim();
    const cleanWhatsapp = regWhatsappSameAsPhone ? cleanPhone : regWhatsapp.trim();
    const cleanEmail = regEmail.trim();
    const cleanCity = regCity.trim() || 'Muzaffarabad';

    if (cleanName.length < 2) {
      setRegError('Please enter your full name (at least 2 characters).');
      return;
    }

    if (cleanPhone.replace(/\D/g, '').length < 10) {
      setRegError('Please enter a valid 11-digit mobile number (e.g. 0300 1234567).');
      return;
    }

    if (!regWhatsappSameAsPhone && cleanWhatsapp.replace(/\D/g, '').length < 10) {
      setRegError('Please enter a valid WhatsApp number (at least 10 digits) for notifications.');
      return;
    }

    if (cleanEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      setRegError('Please enter a valid email address.');
      return;
    }

    setIsRegistering(true);
    const regRes = await apiRegisterCustomer({
      fullName: cleanName,
      phone: cleanPhone,
      email: cleanEmail || undefined,
      city: cleanCity,
      whatsappSameAsPhone: regWhatsappSameAsPhone,
      whatsapp: cleanWhatsapp,
      generateTempPassword: true,
    });
    setIsRegistering(false);

    if (!regRes.ok || !regRes.user) {
      setRegError(regRes.error || 'Registration failed. Please check your details and try again.');
      return;
    }

    const tempPassword = regRes.temporaryPassword || '';
    const resolvedWhatsapp = regRes.whatsappNumber || cleanWhatsapp;
    const confirmedUser: Partial<AppUser> & { role: UserRole } = {
      ...regRes.user,
      role: 'customer',
      whatsapp: resolvedWhatsapp,
      whatsappSameAsPhone: regWhatsappSameAsPhone,
      email: regRes.email || cleanEmail || undefined,
      mustChangePassword: true,
      isAuthenticated: true,
    };

    // Sign customer in right away, while displaying confirmation & temporary password delivery card
    onSelectRole('customer', confirmedUser);

    setRegConfirmation({
      fullName: cleanName,
      phone: cleanPhone,
      whatsappNumber: resolvedWhatsapp,
      email: regRes.email || cleanEmail || undefined,
      temporaryPassword: tempPassword,
      user: confirmedUser,
    });
    setWhatsappSentDone(false);
    setEmailOpenedDone(false);
    setCopiedTempPass(false);
    setModalMode('registration_confirmation');
  };

  const buildConfirmationText = (conf: RegistrationConfirmationState) => {
    const siteOrigin = getCurrentOrigin() || 'our store portal';
    return [
      `Assalam-o-Alaikum ${conf.fullName}!`,
      `Your 100DAGAR customer account is registered and confirmed.`,
      ``,
      `Login Mobile: ${conf.phone}`,
      `Notification WhatsApp: ${conf.whatsappNumber}`,
      ...(conf.email ? [`Email: ${conf.email}`] : []),
      `Temporary Password: ${conf.temporaryPassword}`,
      ``,
      `Please sign in at ${siteOrigin} and change your temporary password from your account settings.`,
    ].join('\n');
  };

  // MANDATORY / FORCED PASSWORD CHANGE HANDLER
  const handleForcedPasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setForcePassError('');

    const nextPin = forcedNewPass.trim();
    if (nextPin.length < 4) {
      setForcePassError('Password must be at least 4 characters long.');
      return;
    }

    if (nextPin !== forcedConfirmPass.trim()) {
      setForcePassError('Confirm password does not match.');
      return;
    }

    if (pendingUserAccount) {
      const changeRes = await apiChangeOwnPassword(pendingCurrentPin, nextPin);
      if (!changeRes.ok) {
        setForcePassError(changeRes.error || 'Could not update your temporary password.');
        return;
      }
      onSelectRole(pendingUserAccount.role, {
        id: pendingUserAccount.id,
        name: pendingUserAccount.fullName,
        urduName: pendingUserAccount.urduName,
        phone: pendingUserAccount.phone,
        whatsapp: pendingUserAccount.whatsapp,
        whatsappSameAsPhone: pendingUserAccount.whatsappSameAsPhone,
        email: pendingUserAccount.email,
        role: pendingUserAccount.role,
        customerId: pendingUserAccount.linkedCustomerId,
        investorId: pendingUserAccount.linkedInvestorId,
        resellerCode: pendingUserAccount.linkedResellerCode,
        branchId: pendingUserAccount.linkedBranchId,
        branchName: pendingUserAccount.linkedBranchName,
        managerAuthorities: pendingUserAccount.managerAuthorities,
        crmRole: pendingUserAccount.crmRole,
        crmPermissions: pendingUserAccount.crmPermissions,
        canAuthorizeCreditSale: pendingUserAccount.canAuthorizeCreditSale,
        mustChangePassword: false,
        hasDefaultPin: false,
        isAuthenticated: true,
      });
    }

    setSuccessMessage('Private password set successfully.');
    setTimeout(() => {
      onClose();
    }, 700);
  };

  // FORGOT PASSWORD HELPLINE HANDLER (Admin-verified reset only; no client-side token printing)
  const handleRequestAdminReset = (e: React.FormEvent) => {
    e.preventDefault();
    setForgotError('');
    setForgotSuccess('');
    const clean = forgotIdentifier.trim();
    if (!clean) {
      setForgotError('Please enter your registered mobile number, email, or username.');
      return;
    }
    logUserLogin({
      userName: clean,
      phone: clean,
      role: 'customer',
      status: 'failed',
      ipOrDevice: 'Password Recovery Request',
      notes: `User requested password reset verification via helpline (${clean})`,
      usedPin: '—',
    });
    openWhatsAppDirect(
      supportNumber,
      `Assalam-o-Alaikum! I need an administrator-verified temporary password reset for my 100DAGAR account (${clean}) on ${getCurrentOrigin() || 'the portal'}. Please send a temporary password to my registered WhatsApp / Email.`
    );
    setForgotSuccess(
      `Recovery request opened for "${clean}". Store support (${supportNumber}) will verify your identity and send a temporary password to your registered WhatsApp / Email.`
    );
  };

  // CHANGE PIN / PASSWORD INSIDE USER PORTAL
  const handleChangePin = async (e: React.FormEvent) => {
    e.preventDefault();
    setChangePinError('');
    setChangePinSuccess('');

    if (!currentPinInput.trim()) {
      setChangePinError('Please enter your current password / PIN.');
      return;
    }

    if (newPinInput.trim().length < 4) {
      setChangePinError('New password must be at least 4 characters long.');
      return;
    }

    if (newPinInput.trim() !== confirmPinInput.trim()) {
      setChangePinError('Confirm password does not match.');
      return;
    }

    const curPin = currentPinInput.trim();
    const nextPin = newPinInput.trim();

    const res =
      currentUser.role === 'super_admin'
        ? await apiChangeMasterPin(curPin, nextPin)
        : await apiChangeOwnPassword(curPin, nextPin);

    if (!res.ok) {
      setChangePinError(res.error || 'Could not update password / PIN.');
      return;
    }

    onSelectRole(currentUser.role, {
      ...currentUser,
      hasDefaultPin: false,
      mustChangePassword: false,
    });
    setChangePinSuccess('Password updated successfully.');
    setCurrentPinInput('');
    setNewPinInput('');
    setConfirmPinInput('');
  };

  const renderSupportFooter = (hintText = 'Need help signing in or registering?') => (
    <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2">
      <span className="text-[11px] text-slate-500 dark:text-slate-400">{hintText}</span>
      <button
        type="button"
        onClick={() => handleOpenSupport()}
        className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 hover:underline flex items-center gap-1 cursor-pointer shrink-0"
      >
        <Phone className="w-3 h-3" />
        <span>Support ({supportNumber})</span>
      </button>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 backdrop-blur-xs p-3 sm:p-4 overflow-y-auto">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl my-4 sm:my-6 transition-colors">
        {/* Header */}
        <div className="bg-[#FFD200] p-4 flex items-center justify-between text-slate-900">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-slate-950 text-amber-400 flex items-center justify-center font-black text-sm shadow-xs">
              100
            </div>
            <div>
              <h2 className="text-base font-black tracking-tight leading-tight">
                {modalMode === 'account'
                  ? 'My Account & Security'
                  : modalMode === 'register'
                  ? 'Register Customer Account'
                  : modalMode === 'registration_confirmation'
                  ? 'Account Confirmed'
                  : modalMode === 'forgot_password'
                  ? 'Password Recovery & Support'
                  : modalMode === 'force_change_password'
                  ? 'Set Your Private Password'
                  : loginConfig.title}
              </h2>
              <span className="text-[11px] font-bold text-amber-900 block tracking-wider uppercase">
                100DAGAR · WE BUY WE SELL
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close login dialog"
            className="p-1.5 text-slate-800 hover:text-black rounded-lg hover:bg-amber-400/50 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Sign In / Register Mode Switcher */}
        {(modalMode === 'login' || modalMode === 'register') && loginConfig.allowSelfRegistration !== false && (
          <div className="px-5 pt-4 sm:px-6">
            <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-800">
              <button
                type="button"
                onClick={() => {
                  setModalMode('login');
                  setErrorMessage('');
                  setRegError('');
                }}
                className={`py-2 text-xs font-bold rounded-lg transition-colors flex items-center justify-center gap-1.5 cursor-pointer ${
                  modalMode === 'login'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <LogIn className="w-3.5 h-3.5" />
                <span>Sign In</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setModalMode('register');
                  setErrorMessage('');
                  setRegError('');
                }}
                className={`py-2 text-xs font-bold rounded-lg transition-colors flex items-center justify-center gap-1.5 cursor-pointer ${
                  modalMode === 'register'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <UserPlus className="w-3.5 h-3.5" />
                <span>Register</span>
              </button>
            </div>
          </div>
        )}

        {/* 1. LOGIN MODE */}
        {modalMode === 'login' && (
          <div className="p-5 sm:p-6 space-y-4">
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                Enter Login Credentials
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                {loginConfig.description}
              </p>
            </div>

            {errorMessage && (
              <div className="p-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 rounded-lg text-xs text-red-700 dark:text-red-300 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span className="whitespace-pre-line">{errorMessage}</span>
              </div>
            )}

            {successMessage && (
              <div className="p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-lg text-xs text-emerald-700 dark:text-emerald-300 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>{successMessage}</span>
              </div>
            )}

            <form onSubmit={handleCombinedLogin} className="space-y-3.5">
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Mobile Number / Email / Username:
                </label>
                <div className="relative">
                  <Phone className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
                  <input
                    type="text"
                    required
                    placeholder="0300 1234567, email, or username"
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-amber-400 focus:outline-hidden"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                    Password / Security PIN:
                  </label>
                  {loginConfig.showForgotPasswordLink && (
                    <button
                      type="button"
                      onClick={() => setModalMode('forgot_password')}
                      className="text-[11px] font-semibold text-amber-600 dark:text-amber-400 hover:underline cursor-pointer"
                    >
                      Forgot Password?
                    </button>
                  )}
                </div>
                <div className="relative">
                  <KeyRound className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
                  <input
                    type={showPin ? 'text' : 'password'}
                    required
                    maxLength={32}
                    placeholder="Enter your password"
                    value={pin}
                    onChange={(e) => setPin(e.target.value)}
                    className="w-full pl-9 pr-10 py-2 text-sm font-mono tracking-widest rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-amber-400 focus:outline-hidden"
                  />
                  {loginConfig.showPasswordVisibilityToggle && (
                    <button
                      type="button"
                      onClick={() => setShowPin(!showPin)}
                      className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                    >
                      {showPin ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  )}
                </div>
              </div>

              {loginConfig.showRememberMe && (
                <div className="flex items-center justify-between text-xs pt-0.5">
                  <label className="flex items-center gap-2 cursor-pointer select-none text-slate-600 dark:text-slate-400">
                    <input
                      type="checkbox"
                      checked={rememberMe}
                      onChange={(e) => setRememberMe(e.target.checked)}
                      className="w-4 h-4 rounded text-amber-500"
                    />
                    <span>Remember Me</span>
                  </label>
                </div>
              )}

              <button
                type="submit"
                disabled={isLoggingIn}
                className="w-full py-2.5 px-4 bg-slate-900 hover:bg-slate-800 dark:bg-amber-500 dark:text-slate-950 dark:hover:bg-amber-400 text-white font-bold text-xs rounded-xl shadow-xs transition-colors flex items-center justify-center gap-2 cursor-pointer mt-2 disabled:opacity-60"
              >
                <LogIn className="w-4 h-4" />
                <span>{isLoggingIn ? 'Signing In...' : 'Sign In / لاگ ان کریں'}</span>
              </button>
            </form>

            {loginConfig.allowSelfRegistration !== false && (
              <div className="p-3 rounded-xl bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 flex items-center justify-between gap-2">
                <div className="text-[11px] text-slate-700 dark:text-slate-300">
                  <span className="font-bold block">New customer? (نیا اکاؤنٹ؟)</span>
                  <span className="text-slate-500 dark:text-slate-400">
                    Register with WhatsApp &amp; Email confirmation.
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setModalMode('register')}
                  className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-[11px] whitespace-nowrap cursor-pointer shrink-0"
                >
                  Register Now
                </button>
              </div>
            )}

            {renderSupportFooter('Need login help or password reset?')}
          </div>
        )}

        {/* 2. REGISTER MODE */}
        {modalMode === 'register' && (
          <div className="p-5 sm:p-6 space-y-4">
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                Create Customer Account (نیا کسٹمر اکاؤنٹ)
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Get instant confirmation and a temporary password for your WhatsApp &amp; Email.
              </p>
            </div>

            {regError && (
              <div className="p-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 rounded-lg text-xs text-red-700 dark:text-red-300 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{regError}</span>
              </div>
            )}

            <form onSubmit={handleCustomerRegister} className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Full Name (پورا نام) *
                </label>
                <div className="relative">
                  <User className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
                  <input
                    type="text"
                    required
                    placeholder="e.g. Tariq Mehmood"
                    value={regName}
                    onChange={(e) => setRegName(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-amber-400 focus:outline-hidden"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Mobile Number (موبائل نمبر) *
                </label>
                <div className="relative">
                  <Phone className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
                  <input
                    type="tel"
                    required
                    placeholder="0300 1234567"
                    value={regPhone}
                    onChange={(e) => setRegPhone(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-amber-400 focus:outline-hidden"
                  />
                </div>
              </div>

              {/* WhatsApp Checkmark & Conditional Number */}
              <div className="p-3 rounded-xl bg-emerald-50/80 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/70 space-y-2.5">
                <label className="flex items-start gap-2.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={regWhatsappSameAsPhone}
                    onChange={(e) => {
                      setRegWhatsappSameAsPhone(e.target.checked);
                      if (e.target.checked) {
                        setRegWhatsapp('');
                      }
                    }}
                    className="mt-0.5 w-4 h-4 rounded text-emerald-600"
                  />
                  <span className="text-xs font-bold text-slate-800 dark:text-slate-100 leading-snug">
                    Is this mobile number your WhatsApp number?
                    <span className="block text-[11px] font-normal text-slate-600 dark:text-slate-400">
                      کیا یہی نمبر آپ کا واٹس ایپ ہے؟ (تصدیق اور نوٹیفکیشن کے لیے)
                    </span>
                  </span>
                </label>

                {!regWhatsappSameAsPhone && (
                  <div>
                    <label className="block text-[11px] font-bold text-emerald-900 dark:text-emerald-300 mb-1">
                      WhatsApp Number for Notifications (نوٹیفکیشن کے لیے واٹس ایپ نمبر) *
                    </label>
                    <div className="relative">
                      <MessageCircle className="w-4 h-4 absolute left-3 top-2.5 text-emerald-600" />
                      <input
                        type="tel"
                        required
                        placeholder="03xx xxxxxxx"
                        value={regWhatsapp}
                        onChange={(e) => setRegWhatsapp(e.target.value)}
                        className="w-full pl-9 pr-3 py-2 text-xs font-mono rounded-lg border border-emerald-300 dark:border-emerald-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-emerald-500 focus:outline-hidden"
                      />
                    </div>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Email (ای میل - عارضی پاس ورڈ کے لیے)
                  </label>
                  <div className="relative">
                    <Mail className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
                    <input
                      type="email"
                      placeholder="name@example.com"
                      value={regEmail}
                      onChange={(e) => setRegEmail(e.target.value)}
                      className="w-full pl-9 pr-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-amber-400 focus:outline-hidden"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    City (شہر)
                  </label>
                  <div className="relative">
                    <MapPin className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
                    <input
                      type="text"
                      placeholder="Muzaffarabad"
                      value={regCity}
                      onChange={(e) => setRegCity(e.target.value)}
                      className="w-full pl-9 pr-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-amber-400 focus:outline-hidden"
                    />
                  </div>
                </div>
              </div>

              <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 text-[11px] text-slate-600 dark:text-slate-300">
                A secure temporary password will be created for your account so you can confirm on your own WhatsApp and Email right away.
              </div>

              <button
                type="submit"
                disabled={isRegistering}
                className="w-full py-2.5 px-4 bg-slate-900 hover:bg-slate-800 dark:bg-amber-500 dark:text-slate-950 dark:hover:bg-amber-400 text-white font-bold text-xs rounded-xl shadow-xs transition-colors flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
              >
                <UserPlus className="w-4 h-4" />
                <span>
                  {isRegistering
                    ? 'Creating Account...'
                    : 'Register & Get Temporary Password'}
                </span>
              </button>
            </form>

            {renderSupportFooter('Already have an account or need support?')}
          </div>
        )}

        {/* 3. REGISTRATION CONFIRMATION & TEMPORARY PASSWORD DELIVERY */}
        {modalMode === 'registration_confirmation' && regConfirmation && (
          <div className="p-5 sm:p-6 space-y-4">
            <div className="p-3.5 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-xl space-y-1.5">
              <div className="flex items-center gap-2 text-emerald-800 dark:text-emerald-300 font-black text-sm">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>Registration Confirmed!</span>
              </div>
              <p className="text-[11px] text-emerald-900/80 dark:text-emerald-200/80 leading-relaxed">
                Welcome <span className="font-bold">{regConfirmation.fullName}</span>. Your account is active. Send your confirmation &amp; temporary password to your own WhatsApp and Email below.
              </p>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-slate-500 dark:text-slate-400">Mobile Login ID:</span>
                <span className="font-mono font-bold text-slate-900 dark:text-white">
                  {regConfirmation.phone}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500 dark:text-slate-400">WhatsApp Notification No:</span>
                <span className="font-mono font-bold text-emerald-700 dark:text-emerald-300">
                  {regConfirmation.whatsappNumber}
                </span>
              </div>
              {regConfirmation.email && (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-500 dark:text-slate-400 shrink-0">Email:</span>
                  <span className="font-mono font-semibold text-slate-800 dark:text-slate-200 truncate">
                    {regConfirmation.email}
                  </span>
                </div>
              )}

              <div className="pt-2 border-t border-slate-200 dark:border-slate-700">
                <span className="text-[11px] font-bold text-slate-600 dark:text-slate-300 block mb-1">
                  Temporary Password (عارضی پاس ورڈ):
                </span>
                <div className="flex items-center gap-2">
                  <div className="flex-1 px-3 py-2 rounded-lg bg-white dark:bg-slate-900 border border-amber-300 dark:border-amber-700 font-mono text-sm font-black tracking-widest text-slate-900 dark:text-amber-300 flex items-center justify-between">
                    <span>
                      {showTempPassword ? regConfirmation.temporaryPassword : '••••••••'}
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowTempPassword(!showTempPassword)}
                      className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
                      aria-label="Toggle temporary password visibility"
                    >
                      {showTempPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard?.writeText(regConfirmation.temporaryPassword);
                      setCopiedTempPass(true);
                      setTimeout(() => setCopiedTempPass(false), 2000);
                    }}
                    className="px-3 py-2 rounded-lg bg-slate-200 hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-800 dark:text-white text-xs font-bold flex items-center gap-1 cursor-pointer shrink-0"
                  >
                    {copiedTempPass ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedTempPass ? 'Copied' : 'Copy'}</span>
                  </button>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <button
                type="button"
                onClick={() => {
                  openWhatsAppDirect(
                    regConfirmation.whatsappNumber,
                    buildConfirmationText(regConfirmation)
                  );
                  setWhatsappSentDone(true);
                }}
                className="w-full py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-xs transition-colors flex items-center justify-center gap-2 cursor-pointer"
              >
                <MessageCircle className="w-4 h-4" />
                <span>
                  {whatsappSentDone
                    ? `WhatsApp Confirmation Opened (${regConfirmation.whatsappNumber})`
                    : `Confirm & Send Temp Password to My WhatsApp (${regConfirmation.whatsappNumber})`}
                </span>
              </button>

              {regConfirmation.email ? (
                <a
                  href={`mailto:${encodeURIComponent(
                    regConfirmation.email
                  )}?subject=${encodeURIComponent(
                    '100DAGAR Account Confirmation & Temporary Password'
                  )}&body=${encodeURIComponent(buildConfirmationText(regConfirmation))}`}
                  onClick={() => setEmailOpenedDone(true)}
                  className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-xs transition-colors flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Mail className="w-4 h-4" />
                  <span>
                    {emailOpenedDone
                      ? `Email Draft Opened (${regConfirmation.email})`
                      : `Send Temp Password to My Email (${regConfirmation.email})`}
                  </span>
                </a>
              ) : (
                <div className="p-2 rounded-lg bg-slate-50 dark:bg-slate-800/50 text-[11px] text-slate-500 dark:text-slate-400 text-center">
                  No email address entered — use WhatsApp confirmation or copy your temporary password above.
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  setPendingUserAccount({
                    id: regConfirmation.user.id || `usr_${Date.now()}`,
                    username: regConfirmation.phone,
                    fullName: regConfirmation.fullName,
                    phone: regConfirmation.phone,
                    whatsapp: regConfirmation.whatsappNumber,
                    whatsappSameAsPhone: regConfirmation.user.whatsappSameAsPhone,
                    email: regConfirmation.email,
                    role: 'customer',
                    status: 'active',
                    linkedCustomerId: regConfirmation.user.customerId,
                    mustChangePassword: true,
                    createdAt: new Date().toISOString(),
                  });
                  setPendingCurrentPin(regConfirmation.temporaryPassword);
                  setForcedNewPass('');
                  setForcedConfirmPass('');
                  setForcePassError('');
                  setModalMode('force_change_password');
                }}
                className="py-2 px-3 border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-200 font-bold text-xs rounded-xl cursor-pointer"
              >
                Set Private Password
              </button>
              <button
                type="button"
                onClick={onClose}
                className="py-2 px-3 bg-slate-900 hover:bg-slate-800 dark:bg-amber-500 dark:text-slate-950 dark:hover:bg-amber-400 text-white font-bold text-xs rounded-xl cursor-pointer"
              >
                Continue to Portal
              </button>
            </div>

            {renderSupportFooter('Need assistance with confirmation?')}
          </div>
        )}

        {/* 4. FORCE CHANGE PASSWORD (First login with temporary password) */}
        {modalMode === 'force_change_password' && (
          <div className="p-5 sm:p-6 space-y-4">
            <div className="p-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-700 rounded-xl space-y-1 text-xs text-amber-900 dark:text-amber-200">
              <div className="flex items-center gap-1.5 font-bold text-amber-800 dark:text-amber-300">
                <ShieldCheck className="w-4 h-4 text-amber-600 shrink-0" />
                <span>Set Your New Private Password</span>
              </div>
              <p className="text-[11px] leading-relaxed">
                Since you signed in with a temporary password, please set your own private password to secure your account.
              </p>
            </div>

            {forcePassError && (
              <div className="p-2.5 bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 rounded-lg text-xs flex items-center gap-1.5">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{forcePassError}</span>
              </div>
            )}

            {successMessage && (
              <div className="p-2.5 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 rounded-lg text-xs flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>{successMessage}</span>
              </div>
            )}

            <form onSubmit={handleForcedPasswordSubmit} className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  New Private Password (نیا پرائیویٹ پاس ورڈ):
                </label>
                <input
                  type="password"
                  required
                  minLength={4}
                  placeholder="Min 4 characters"
                  value={forcedNewPass}
                  onChange={(e) => setForcedNewPass(e.target.value)}
                  className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-amber-400 focus:outline-hidden"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Confirm New Password (پاس ورڈ کی تصدیق):
                </label>
                <input
                  type="password"
                  required
                  minLength={4}
                  placeholder="Repeat new password"
                  value={forcedConfirmPass}
                  onChange={(e) => setForcedConfirmPass(e.target.value)}
                  className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-amber-400 focus:outline-hidden"
                />
              </div>

              <button
                type="submit"
                className="w-full py-2.5 bg-slate-900 hover:bg-slate-800 dark:bg-amber-500 dark:text-slate-950 dark:hover:bg-amber-400 text-white font-bold text-xs rounded-xl shadow-xs transition-colors cursor-pointer mt-2"
              >
                Save Password &amp; Proceed to Portal
              </button>
            </form>

            {renderSupportFooter('Having trouble updating password?')}
          </div>
        )}

        {/* 5. FORGOT PASSWORD & SUPPORT RECOVERY FLOW */}
        {modalMode === 'forgot_password' && (
          <div className="p-5 sm:p-6 space-y-4">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setModalMode('login')}
                className="p-1 rounded text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                Account Recovery &amp; Support (پاس ورڈ بحالی)
              </h3>
            </div>

            {forgotError && (
              <div className="p-2.5 bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 rounded-lg text-xs flex items-center gap-1.5">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{forgotError}</span>
              </div>
            )}

            {forgotSuccess && (
              <div className="p-2.5 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 rounded-lg text-xs flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>{forgotSuccess}</span>
              </div>
            )}

            <form onSubmit={handleRequestAdminReset} className="space-y-3.5">
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                For account security, temporary password resets are verified by Store Support ({supportNumber}) and delivered to your registered WhatsApp or Email.
              </p>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Registered Mobile / Email / Username:
                </label>
                <input
                  type="text"
                  required
                  placeholder="0300 1234567 or email"
                  value={forgotIdentifier}
                  onChange={(e) => setForgotIdentifier(e.target.value)}
                  className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-amber-400 focus:outline-hidden"
                />
              </div>

              <button
                type="submit"
                className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-xs transition-colors flex items-center justify-center gap-2 cursor-pointer"
              >
                <MessageCircle className="w-4 h-4" />
                <span>Request Temporary Password via Support WhatsApp</span>
              </button>
            </form>

            {renderSupportFooter('Direct helpline always available')}
          </div>
        )}

        {/* 6. ACCOUNT PORTAL (For Authenticated Users) */}
        {modalMode === 'account' && (
          <div className="p-5 sm:p-6 space-y-5">
            <div className="p-4 bg-slate-50 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h3 className="font-extrabold text-sm text-slate-900 dark:text-white flex items-center gap-2">
                    {currentUser.name}
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-300">
                      {currentUser.role.replace('_', ' ')}
                    </span>
                  </h3>
                  {currentUser.phone && (
                    <span className="text-xs font-mono text-slate-500 dark:text-slate-400 block mt-0.5">
                      Mobile: {currentUser.phone}
                    </span>
                  )}
                  {(currentUser.whatsapp || currentUser.phone) && (
                    <span className="text-xs font-mono text-emerald-700 dark:text-emerald-300 block mt-0.5">
                      WhatsApp Alerts: {currentUser.whatsapp || currentUser.phone}
                    </span>
                  )}
                  {currentUser.email && (
                    <span className="text-xs text-slate-500 dark:text-slate-400 block mt-0.5">
                      Email: {currentUser.email}
                    </span>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => {
                    if (onLogout) {
                      onLogout();
                    } else {
                      onSelectRole('customer', defaultGuestUser);
                    }
                    setIdentifier('');
                    setPin('');
                    setModalMode('login');
                  }}
                  className="px-2.5 py-1 text-xs text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/50 rounded-lg border border-red-200 dark:border-red-900 flex items-center gap-1 cursor-pointer font-semibold shrink-0"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>Logout</span>
                </button>
              </div>
            </div>

            {/* In-Portal Change Password Form */}
            <div className="border-t border-slate-200 dark:border-slate-800 pt-4 space-y-3">
              <div className="flex items-center gap-1.5 text-xs font-bold text-slate-900 dark:text-white">
                <Lock className="w-4 h-4 text-amber-600" />
                <span>Change Your Security Password / PIN</span>
              </div>

              {changePinError && (
                <div className="p-2.5 bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 rounded-lg text-xs flex items-center gap-1.5">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{changePinError}</span>
                </div>
              )}

              {changePinSuccess && (
                <div className="p-2.5 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 rounded-lg text-xs flex items-center gap-1.5">
                  <Check className="w-4 h-4 shrink-0" />
                  <span>{changePinSuccess}</span>
                </div>
              )}

              <form onSubmit={handleChangePin} className="space-y-2.5 text-xs">
                <div>
                  <label className="block text-slate-600 dark:text-slate-400 mb-0.5">
                    Current Password / PIN:
                  </label>
                  <input
                    type="password"
                    required
                    maxLength={32}
                    value={currentPinInput}
                    onChange={(e) => setCurrentPinInput(e.target.value)}
                    className="w-full px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-mono tracking-widest text-xs"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-slate-600 dark:text-slate-400 mb-0.5">
                      New Password:
                    </label>
                    <input
                      type="password"
                      required
                      minLength={4}
                      value={newPinInput}
                      onChange={(e) => setNewPinInput(e.target.value)}
                      className="w-full px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-mono tracking-widest text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-600 dark:text-slate-400 mb-0.5">
                      Confirm Password:
                    </label>
                    <input
                      type="password"
                      required
                      minLength={4}
                      value={confirmPinInput}
                      onChange={(e) => setConfirmPinInput(e.target.value)}
                      className="w-full px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-mono tracking-widest text-xs"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  className="w-full py-2 bg-slate-900 hover:bg-slate-800 dark:bg-amber-500 dark:text-slate-950 dark:hover:bg-amber-400 text-white font-bold rounded-lg cursor-pointer transition-colors"
                >
                  Update &amp; Save New Password
                </button>
              </form>
            </div>

            {renderSupportFooter('Customer Support Helpline')}
          </div>
        )}
      </div>
    </div>
  );
};
