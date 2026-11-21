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
  Sparkles,
  HelpCircle,
  ArrowLeft,
  CheckCircle2,
} from 'lucide-react';
import { AppUser, Customer, LoginFormConfig, Reseller, UserAccount, UserRole } from '../types/index.ts';
import {
  defaultGuestUser,
  getDefaultPinForPhone,
  getLoginFormConfig,
  logUserLogin,
  apiAuthenticateLogin,
  apiRegisterCustomer,
  apiChangeOwnPassword,
  apiChangeMasterPin,
} from '../utils/storage.ts';
import { openWhatsAppDirect } from '../utils/whatsapp.ts';

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
  customers = [],
  resellers = [],
  onLogout,
}) => {
  const isGuest = currentUser?.isAuthenticated !== true;

  const [modalMode, setModalMode] = useState<'login' | 'account' | 'forgot_password' | 'force_change_password'>(
    isGuest ? 'login' : 'account'
  );

  const [loginConfig, setLoginConfig] = useState<LoginFormConfig>(getLoginFormConfig);

  // Unified Single Login Inputs
  const [identifier, setIdentifier] = useState('');
  const [pin, setPin] = useState('');
  const [fullName, setFullName] = useState('');
  const [rememberMe, setRememberMe] = useState(true);
  const [showPin, setShowPin] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  // Pending user when mandatory password change or new registration is required
  const [pendingUserAccount, setPendingUserAccount] = useState<UserAccount | null>(null);
  const [pendingCurrentPin, setPendingCurrentPin] = useState('');
  const [pendingIsNewRegistration, setPendingIsNewRegistration] = useState(false);
  const [forcedNewPass, setForcedNewPass] = useState('');
  const [forcedConfirmPass, setForcedConfirmPass] = useState('');
  const [forcePassError, setForcePassError] = useState('');

  // Forgot password helpline state
  const [forgotIdentifier, setForgotIdentifier] = useState('');
  const [forgotError, setForgotError] = useState('');
  const [forgotSuccess, setForgotSuccess] = useState('');

  // Change PIN State inside Account Portal
  const [currentPinInput, setCurrentPinInput] = useState('');
  const [newPinInput, setNewPinInput] = useState('');
  const [confirmPinInput, setConfirmPinInput] = useState('');
  const [changePinError, setChangePinError] = useState('');
  const [changePinSuccess, setChangePinSuccess] = useState('');

  useEffect(() => {
    if (isOpen) {
      setErrorMessage('');
      setSuccessMessage('');
      setChangePinError('');
      setChangePinSuccess('');
      setForgotError('');
      setForgotSuccess('');
      setForcePassError('');
      setCurrentPinInput('');
      setNewPinInput('');
      setConfirmPinInput('');
      setLoginConfig(getLoginFormConfig());

      if (currentUser?.isAuthenticated === true) {
        setModalMode('account');
      } else {
        setModalMode('login');
      }
    }
  }, [isOpen, currentUser?.isAuthenticated]);

  if (!isOpen) return null;

  // SERVER-AUTHORITATIVE COMBINED LOGIN HANDLER
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
      setErrorMessage('Please enter your valid security PIN / password (min 4 characters).');
      return;
    }

    // 1. Authenticate authoritatively with backend /api/auth/login (issues signed sessionToken & scrypt check)
    const serverAuth = await apiAuthenticateLogin(identifier.trim(), cleanPin);
    if (serverAuth.ok && serverAuth.user) {
      const authUser = serverAuth.user as Partial<AppUser> & { role: UserRole };
      if (authUser.mustChangePassword === true) {
        setPendingUserAccount({
          id: authUser.id || `usr_${Date.now()}`,
          username: cleanId,
          fullName: authUser.name || 'User',
          urduName: authUser.urduName,
          phone: authUser.phone || cleanId,
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
        setPendingIsNewRegistration(false);
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

    // 2. Check if already-known customer/reseller exists locally (do not auto-register existing numbers on wrong PIN)
    const cleanIdLower = identifier.trim().toLowerCase();
    const alreadyExists =
      customers.some(
        (c) => normalizePhoneOrId(c.phone) === cleanId || (c.email && c.email.toLowerCase() === cleanIdLower)
      ) ||
      resellers.some(
        (r) => normalizePhoneOrId(r.phone) === cleanId || r.referralCode.toLowerCase() === cleanIdLower
      );

    if (alreadyExists) {
      setErrorMessage('Invalid PIN or password for this account. Please verify your credentials or contact support.');
      return;
    }

    // 3. Instant Customer Self-Registration (only for brand-new unregistered mobile numbers using default last-6-digits PIN)
    const digitsOnly = cleanId.replace(/\D/g, '');
    if (loginConfig.allowSelfRegistration && digitsOnly.length >= 10) {
      const defaultPin = getDefaultPinForPhone(cleanId);
      if (cleanPin === defaultPin) {
        const newCustName = fullName.trim() || `Customer ${digitsOnly.slice(-4)}`;
        const newAccount: UserAccount = {
          id: `usr_${Date.now()}`,
          username: cleanId,
          fullName: newCustName,
          phone: cleanId,
          role: 'customer',
          status: 'active',
          mustChangePassword: true,
          isTemporaryPassword: true,
          createdAt: new Date().toISOString(),
        };
        setPendingUserAccount(newAccount);
        setPendingCurrentPin(cleanPin);
        setPendingIsNewRegistration(true);
        setModalMode('force_change_password');
        return;
      }
    }

    setErrorMessage('Invalid credentials. Please check your mobile number / username and password.');
  };

  // MANDATORY / FORCED PASSWORD CHANGE OR SELF-REGISTRATION COMPLETION HANDLER
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
      if (pendingIsNewRegistration) {
        const regRes = await apiRegisterCustomer({
          fullName: pendingUserAccount.fullName,
          phone: pendingUserAccount.phone,
          pin: nextPin,
        });
        if (!regRes.ok || !regRes.user) {
          setForcePassError(regRes.error || 'Could not complete registration. Please check your details.');
          return;
        }
        onSelectRole('customer', {
          ...regRes.user,
          mustChangePassword: false,
          hasDefaultPin: false,
          isAuthenticated: true,
        });
      } else {
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
    }

    setSuccessMessage('Password set successfully.');
    setTimeout(() => {
      onClose();
    }, 800);
  };

  // FORGOT PASSWORD HELPLINE HANDLER (Admin-verified reset only; no client-side token printing)
  const handleRequestAdminReset = (e: React.FormEvent) => {
    e.preventDefault();
    setForgotError('');
    setForgotSuccess('');
    const clean = forgotIdentifier.trim();
    if (!clean) {
      setForgotError('Please enter your registered mobile number or username.');
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
    const supportNumber = loginConfig.supportContactNumber || '03125256266';
    openWhatsAppDirect(
      supportNumber,
      `Assalam-o-Alaikum! I need an administrator-verified password reset for my 100DAGAR / madinamarket.pk account (${clean}). Please assist.`
    );
    setForgotSuccess(
      `Recovery request logged for "${clean}". Store administration will verify your identity via WhatsApp (${supportNumber}) and issue a temporary PIN.`
    );
  };

  // CHANGE PIN HANDLER INSIDE USER PORTAL (Supports ALL authenticated roles via server API)
  const handleChangePin = async (e: React.FormEvent) => {
    e.preventDefault();
    setChangePinError('');
    setChangePinSuccess('');

    if (!currentPinInput.trim()) {
      setChangePinError('Please enter your current PIN.');
      return;
    }

    if (newPinInput.trim().length < 4) {
      setChangePinError('New PIN must be at least 4 digits/characters long.');
      return;
    }

    if (newPinInput.trim() !== confirmPinInput.trim()) {
      setChangePinError('Confirm PIN does not match.');
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
    setChangePinSuccess('Password changed successfully.');
    setCurrentPinInput('');
    setNewPinInput('');
    setConfirmPinInput('');
  };

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
                  : modalMode === 'forgot_password'
                  ? 'Password Recovery'
                  : modalMode === 'force_change_password'
                  ? 'Set Your Private Password'
                  : loginConfig.title}
              </h2>
              <span className="text-[11px] font-bold text-amber-900 dark:text-amber-300 block tracking-wider uppercase">
                100DAGAR · WE BUY WE SELL
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-800 hover:text-black rounded-lg hover:bg-amber-400/50 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 1. LOGIN MODE: CONFIGURABLE UNIFIED LOGIN FORM */}
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

            {/* Error Message */}
            {errorMessage && (
              <div className="p-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 rounded-lg text-xs text-red-700 dark:text-red-300 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span className="whitespace-pre-line">{errorMessage}</span>
              </div>
            )}

            {/* Success Message */}
            {successMessage && (
              <div className="p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-lg text-xs text-emerald-700 dark:text-emerald-300 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>{successMessage}</span>
              </div>
            )}

            <form onSubmit={handleCombinedLogin} className="space-y-3.5">
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Mobile Number / Username / Handle:
                </label>
                <div className="relative">
                  <Phone className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
                  <input
                    type="text"
                    required
                    placeholder="0300 1234567 or username"
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-amber-400 focus:outline-hidden"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                    Security PIN / Password:
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
                    maxLength={20}
                    placeholder="••••••"
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

              {loginConfig.allowSelfRegistration && (
                <div>
                  <label className="block text-xs font-normal text-slate-500 dark:text-slate-400 mb-1">
                    Your Full Name (اختیاری - نئے کسٹمرز کے لیے):
                  </label>
                  <div className="relative">
                    <User className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
                    <input
                      type="text"
                      placeholder="e.g. Tariq Mehmood"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      className="w-full pl-9 pr-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-amber-400 focus:outline-hidden"
                    />
                  </div>
                </div>
              )}

              {loginConfig.showRememberMe && (
                <div className="flex items-center justify-between text-xs pt-1">
                  <label className="flex items-center gap-2 cursor-pointer select-none text-slate-600 dark:text-slate-400">
                    <input
                      type="checkbox"
                      checked={rememberMe}
                      onChange={(e) => setRememberMe(e.target.checked)}
                      className="w-4 h-4 rounded text-amber-500"
                    />
                    <span>Remember Me</span>
                  </label>

                  <span className="text-[11px] text-slate-400">
                    Default PIN: Last 6 digits
                  </span>
                </div>
              )}

              <button
                type="submit"
                className="w-full py-2.5 px-4 bg-slate-900 hover:bg-slate-800 dark:bg-amber-500 dark:text-slate-950 dark:hover:bg-amber-400 text-white font-bold text-xs rounded-xl shadow-xs transition-colors flex items-center justify-center gap-2 cursor-pointer mt-2"
              >
                <LogIn className="w-4 h-4" />
                <span>Sign In / لاگ ان کریں</span>
              </button>
            </form>

            {/* Support Helpline Footer */}
            <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
              <span className="text-[11px] text-slate-500 dark:text-slate-400">
                Sign in with your account credentials
              </span>
              <button
                type="button"
                onClick={() => {
                  const text = 'السلام علیکم! مجھے 100DAGAR اکاؤنٹ میں لاگ ان / پاس ورڈ میں مدد چاہیے۔ شکریہ!';
                  openWhatsAppDirect(loginConfig.supportContactNumber || '03125256266', text);
                }}
                className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 hover:underline flex items-center gap-1 cursor-pointer"
              >
                <Phone className="w-3 h-3" />
                <span>Support ({loginConfig.supportContactNumber})</span>
              </button>
            </div>
          </div>
        )}

        {/* 2. FORCE CHANGE PASSWORD (First login with default/temporary PIN) */}
        {modalMode === 'force_change_password' && (
          <div className="p-5 sm:p-6 space-y-4">
            <div className="p-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-700 rounded-xl space-y-1 text-xs text-amber-900 dark:text-amber-200">
              <div className="flex items-center gap-1.5 font-bold text-amber-800 dark:text-amber-300">
                <ShieldCheck className="w-4 h-4 text-amber-600 shrink-0" />
                <span>Set Your New Private Password</span>
              </div>
              <p className="text-[11px] leading-relaxed">
                Welcome to 100DAGAR! Since you logged in using a temporary or default PIN, please establish a secure new password for your account.
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
                  New Private Password / PIN (نیا پاس ورڈ):
                </label>
                <input
                  type="password"
                  required
                  minLength={4}
                  placeholder="Min 4 to 6 characters"
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
          </div>
        )}

        {/* 3. FORGOT PASSWORD ADMIN-VERIFIED RECOVERY FLOW */}
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
                Account Recovery (پاس ورڈ بحالی)
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
                For account security, password resets are verified by Store Administration via your registered WhatsApp number ({loginConfig.supportContactNumber || '03125256266'}).
              </p>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Registered Mobile / Username:
                </label>
                <input
                  type="text"
                  required
                  placeholder="0300 1234567"
                  value={forgotIdentifier}
                  onChange={(e) => setForgotIdentifier(e.target.value)}
                  className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-amber-400 focus:outline-hidden"
                />
              </div>

              <button
                type="submit"
                className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-xs transition-colors cursor-pointer"
              >
                Request Verified Reset on WhatsApp
              </button>
            </form>
          </div>
        )}

        {/* 4. ACCOUNT PORTAL (For Authenticated Users) */}
        {modalMode === 'account' && (
          <div className="p-5 sm:p-6 space-y-5">
            <div className="p-4 bg-slate-50 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-extrabold text-sm text-slate-900 dark:text-white flex items-center gap-2">
                    {currentUser.name}
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-300">
                      {currentUser.role.replace('_', ' ')}
                    </span>
                  </h3>
                  {currentUser.phone && (
                    <span className="text-xs font-mono text-slate-500 dark:text-slate-400 block mt-0.5">
                      📱 {currentUser.phone}
                    </span>
                  )}
                </div>

                <button
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
                  className="px-2.5 py-1 text-xs text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/50 rounded-lg border border-red-200 dark:border-red-900 flex items-center gap-1 cursor-pointer font-semibold"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>Logout</span>
                </button>
              </div>
            </div>

            {/* In-Portal Change PIN Form */}
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
                    Current PIN:
                  </label>
                  <input
                    type="password"
                    required
                    maxLength={20}
                    value={currentPinInput}
                    onChange={(e) => setCurrentPinInput(e.target.value)}
                    className="w-full px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-mono tracking-widest text-xs"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-slate-600 dark:text-slate-400 mb-0.5">
                      New PIN:
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
                      Confirm PIN:
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
                  Update &amp; Save New PIN
                </button>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
