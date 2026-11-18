import React, { useState } from 'react';
import type { User } from 'firebase/auth';
import {
  Check,
  Cloud,
  FolderOpen,
  LogIn,
  MessageSquare,
  Plus,
  Send,
  Trash2,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import type {
  ProjectInvite,
  ProjectMember,
  ProjectMembershipSummary,
  SessionComment,
  StudioProject,
} from '../types/studio';

interface CollaborateViewProps {
  user: User | null;
  project: StudioProject;
  memberships: ProjectMembershipSummary[];
  members: ProjectMember[];
  incomingInvites: ProjectInvite[];
  sentInvites: ProjectInvite[];
  comments: SessionComment[];
  currentPlayheadSec: number;
  isSavingCloud: boolean;
  isLoadingCloud: boolean;
  cloudError: string | null;
  onSignIn: () => void;
  onSaveToCloud: () => void;
  onNewLocalSession: () => void;
  onOpenCloudProject: (projectId: string) => void;
  onSendInvite: (email: string, role: 'editor' | 'viewer') => Promise<void>;
  onAcceptInvite: (invite: ProjectInvite) => Promise<void>;
  onRevokeInvite: (inviteId: string) => Promise<void>;
  onUpdateMemberRole: (memberUid: string, role: 'editor' | 'viewer') => Promise<void>;
  onRemoveMember: (memberUid: string) => Promise<void>;
  onPostComment: (text: string) => Promise<void>;
  onSeekToTimecode: (sec: number) => void;
}

function formatTimecode(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = (sec % 60).toFixed(1).padStart(4, '0');
  return `${String(m).padStart(2, '0')}:${s}`;
}

export const CollaborateView: React.FC<CollaborateViewProps> = ({
  user,
  project,
  memberships,
  members,
  incomingInvites,
  sentInvites,
  comments,
  currentPlayheadSec,
  isSavingCloud,
  isLoadingCloud,
  cloudError,
  onSignIn,
  onSaveToCloud,
  onNewLocalSession,
  onOpenCloudProject,
  onSendInvite,
  onAcceptInvite,
  onRevokeInvite,
  onUpdateMemberRole,
  onRemoveMember,
  onPostComment,
  onSeekToTimecode,
}) => {
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'editor' | 'viewer'>('editor');
  const [commentText, setCommentText] = useState('');
  const [busyAction, setBusyAction] = useState(false);

  if (!user) {
    return (
      <div className="bg-[#161B22] border border-[#2A3241] rounded-lg p-10 max-w-2xl mx-auto my-8 text-center space-y-4">
        <div className="w-12 h-12 rounded-lg bg-[#1B212B] border border-[#2A3241] flex items-center justify-center mx-auto text-[#E59A3C]">
          <Cloud className="w-6 h-6" />
        </div>
        <h2 className="text-xl font-semibold text-slate-100">
          Cloud Storage &amp; Musician Collaboration
        </h2>
        <p className="text-sm text-slate-300 leading-relaxed max-w-md mx-auto">
          Sign in with your Google account to save multi-track stems to the cloud, invite bandmates and producers as editors or viewers, and leave timestamped mix notes.
        </p>
        <div className="pt-2">
          <button
            type="button"
            onClick={onSignIn}
            className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold bg-[#E59A3C] text-[#0E1116] rounded-md hover:bg-amber-400 transition-colors"
          >
            <LogIn className="w-4 h-4" />
            Sign In with Google
          </button>
        </div>
      </div>
    );
  }

  const isOwner = project.isCloudBacked && project.ownerId === user.uid;
  const pendingIncoming = incomingInvites.filter((i) => i.status === 'pending');

  const handleInviteSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail.trim()) return;
    setBusyAction(true);
    try {
      await onSendInvite(inviteEmail.trim(), inviteRole);
      setInviteEmail('');
    } finally {
      setBusyAction(false);
    }
  };

  const handleCommentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!commentText.trim()) return;
    setBusyAction(true);
    try {
      await onPostComment(commentText.trim());
      setCommentText('');
    } finally {
      setBusyAction(false);
    }
  };

  return (
    <div className="space-y-5">
      {cloudError && (
        <div className="px-4 py-3 bg-red-950/50 border border-red-800/70 rounded-md text-xs text-red-200">
          {cloudError}
        </div>
      )}

      {/* Pending Invites Banner */}
      {pendingIncoming.length > 0 && (
        <div className="bg-[#161B22] border border-amber-500/40 rounded-lg p-4 space-y-3">
          <h3 className="text-sm font-semibold text-amber-300">
            Incoming Session Invitations ({pendingIncoming.length})
          </h3>
          <div className="divide-y divide-[#2A3241]">
            {pendingIncoming.map((inv) => (
              <div key={inv.id} className="py-2.5 flex flex-wrap items-center justify-between gap-3">
                <div className="text-xs text-slate-200">
                  <span className="font-semibold">{inv.projectTitle}</span>
                  <span className="text-slate-400"> · Invited by {inv.inviterName} as {inv.role}</span>
                </div>
                <button
                  type="button"
                  onClick={() => onAcceptInvite(inv)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-emerald-600 text-white rounded-md hover:bg-emerald-500 transition-colors"
                >
                  <Check className="w-3.5 h-3.5" />
                  Accept &amp; Join
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Left: Cloud Projects Library */}
        <div className="lg:col-span-5 bg-[#161B22] border border-[#2A3241] rounded-lg p-5 flex flex-col gap-4">
          <div className="flex items-center justify-between gap-2 border-b border-[#2A3241] pb-3">
            <div>
              <h2 className="text-base font-semibold text-slate-100">Cloud Studio Vault</h2>
              <p className="text-xs text-slate-400">
                Signed in as {user.displayName || user.email}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onNewLocalSession}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium bg-[#1B212B] text-slate-200 border border-[#2A3241] rounded-md hover:border-slate-500 whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5" />
                New
              </button>
              <button
                type="button"
                disabled={isSavingCloud || project.role === 'viewer'}
                onClick={onSaveToCloud}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-[#E59A3C] text-[#0E1116] rounded-md hover:bg-amber-400 disabled:opacity-40 whitespace-nowrap"
              >
                <Cloud className="w-3.5 h-3.5" />
                {isSavingCloud ? 'Syncing Stems...' : project.isCloudBacked ? 'Sync Changes' : 'Save to Cloud'}
              </button>
            </div>
          </div>

          <div className="space-y-2 max-h-[380px] overflow-y-auto">
            {memberships.length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-400">
                No cloud sessions saved yet. Click &quot;Save to Cloud&quot; to upload your active project and stems.
              </div>
            ) : (
              memberships.map((m) => {
                const isActive = project.isCloudBacked && project.id === m.projectId;
                return (
                  <div
                    key={m.id}
                    className={`p-3 rounded-md border flex items-center justify-between gap-3 transition-colors ${
                      isActive
                        ? 'bg-[#1D2430] border-[#E59A3C]/60'
                        : 'bg-[#11151C] border-[#2A3241] hover:border-slate-600'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-slate-100 truncate">
                        {m.projectTitle}
                      </div>
                      <div className="text-xs text-slate-400">
                        Owner: {m.ownerName} · Role: {m.role}
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={isLoadingCloud || isActive}
                      onClick={() => onOpenCloudProject(m.projectId)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-[#1B212B] text-slate-200 border border-[#2A3241] rounded-md hover:border-slate-500 disabled:opacity-50 whitespace-nowrap shrink-0"
                    >
                      <FolderOpen className="w-3.5 h-3.5" />
                      {isActive ? 'Loaded' : isLoadingCloud ? 'Loading...' : 'Open'}
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Center/Right: Collaborators & Timestamped Mix Notes */}
        <div className="lg:col-span-7 space-y-5">
          {/* Team & Invites */}
          <div className="bg-[#161B22] border border-[#2A3241] rounded-lg p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-[#2A3241] pb-3">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-[#E59A3C]" />
                <h3 className="text-sm font-semibold text-slate-100">
                  Session Collaborators
                </h3>
              </div>
              <span className="text-xs text-slate-400">
                {project.isCloudBacked ? `Role: ${project.role}` : 'Save project to cloud first'}
              </span>
            </div>

            {!project.isCloudBacked ? (
              <p className="text-xs text-slate-400">
                Save this session to the cloud to invite vocalists, instrumentalists, or mixing engineers.
              </p>
            ) : (
              <>
                {isOwner && (
                  <form onSubmit={handleInviteSubmit} className="flex flex-wrap gap-2">
                    <input
                      type="email"
                      required
                      placeholder="Collaborator Google email..."
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                      className="flex-1 min-w-[200px] bg-[#0E1116] border border-[#2A3241] rounded-md px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-[#E59A3C]"
                    />
                    <select
                      value={inviteRole}
                      onChange={(e) => setInviteRole(e.target.value as 'editor' | 'viewer')}
                      className="bg-[#0E1116] border border-[#2A3241] rounded-md px-3 py-2 text-xs text-slate-200"
                    >
                      <option value="editor">Editor (Record &amp; Mix)</option>
                      <option value="viewer">Viewer (Listen &amp; Comment)</option>
                    </select>
                    <button
                      type="submit"
                      disabled={busyAction}
                      className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-[#E59A3C] text-[#0E1116] rounded-md hover:bg-amber-400 disabled:opacity-40 whitespace-nowrap"
                    >
                      <UserPlus className="w-3.5 h-3.5" />
                      Send Invite
                    </button>
                  </form>
                )}

                {isOwner && members.length > 0 && (
                  <div className="divide-y divide-[#2A3241] border-t border-[#2A3241]">
                    {members.map((mem) => (
                      <div key={mem.userId} className="py-2.5 flex items-center justify-between gap-3">
                        <div className="text-xs">
                          <span className="font-medium text-slate-100">{mem.displayName}</span>
                          <span className="text-slate-400"> · {mem.role}</span>
                        </div>
                        {mem.userId !== project.ownerId && (
                          <div className="flex items-center gap-2">
                            <select
                              value={mem.role}
                              onChange={(e) =>
                                onUpdateMemberRole(mem.userId, e.target.value as 'editor' | 'viewer')
                              }
                              className="bg-[#0E1116] border border-[#2A3241] rounded px-2 py-1 text-xs text-slate-200"
                            >
                              <option value="editor">Editor</option>
                              <option value="viewer">Viewer</option>
                            </select>
                            <button
                              type="button"
                              onClick={() => onRemoveMember(mem.userId)}
                              title="Revoke access"
                              className="p-1 text-slate-400 hover:text-red-400"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {isOwner && sentInvites.filter((i) => i.status === 'pending').length > 0 && (
                  <div className="pt-2 border-t border-[#2A3241] space-y-1.5">
                    <div className="text-xs font-medium text-slate-400">Pending Invitations</div>
                    {sentInvites
                      .filter((i) => i.status === 'pending')
                      .map((inv) => (
                        <div key={inv.id} className="flex items-center justify-between text-xs text-slate-300">
                          <span>
                            {inv.inviteeEmail} · {inv.role}
                          </span>
                          <button
                            type="button"
                            onClick={() => onRevokeInvite(inv.id)}
                            className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-red-400"
                          >
                            <X className="w-3 h-3" />
                            Revoke
                          </button>
                        </div>
                      ))}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Timestamped Mix Notes */}
          <div className="bg-[#161B22] border border-[#2A3241] rounded-lg p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-[#2A3241] pb-3">
              <div className="flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-[#E59A3C]" />
                <h3 className="text-sm font-semibold text-slate-100">
                  Timestamped Mix Notes
                </h3>
              </div>
              <span className="font-mono-tabular text-xs text-slate-400">
                Playhead: {formatTimecode(currentPlayheadSec)}
              </span>
            </div>

            {!project.isCloudBacked ? (
              <p className="text-xs text-slate-400">
                Save the project to the cloud to post timestamped collaborator notes.
              </p>
            ) : (
              <>
                <form onSubmit={handleCommentSubmit} className="flex gap-2">
                  <input
                    type="text"
                    placeholder={`Add mix note at ${formatTimecode(currentPlayheadSec)}...`}
                    value={commentText}
                    onChange={(e) => setCommentText(e.target.value)}
                    maxLength={500}
                    className="flex-1 bg-[#0E1116] border border-[#2A3241] rounded-md px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-[#E59A3C]"
                  />
                  <button
                    type="submit"
                    disabled={busyAction || !commentText.trim()}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-[#E59A3C] text-[#0E1116] rounded-md hover:bg-amber-400 disabled:opacity-40 whitespace-nowrap"
                  >
                    <Send className="w-3.5 h-3.5" />
                    Post Note
                  </button>
                </form>

                <div className="space-y-2 max-h-[220px] overflow-y-auto">
                  {comments.length === 0 ? (
                    <p className="text-xs text-slate-400 py-3">
                      No mix notes yet. Scrub the timeline and leave feedback for your collaborators.
                    </p>
                  ) : (
                    comments.map((c) => (
                      <div
                        key={c.id}
                        className="p-2.5 bg-[#11151C] border border-[#2A3241] rounded-md flex items-start justify-between gap-3"
                      >
                        <div className="space-y-0.5 min-w-0">
                          <div className="text-xs text-slate-300">
                            <span className="font-semibold text-slate-100">{c.authorName}</span>
                          </div>
                          <p className="text-xs text-slate-300 break-words">{c.text}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => onSeekToTimecode(c.timecodeSec)}
                          className="font-mono-tabular text-xs text-amber-300 hover:underline shrink-0"
                        >
                          {formatTimecode(c.timecodeSec)}
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
