

import asyncHandler from "../utils/asyncHandler.js";
import ApiError from "../utils/ApiError.js";
import Invitation from "../models/Invitation.js";
import Workspace from "../models/Workspace.js";
import User from "../models/User.js";
import Notification from "../models/Notification.js";

export const createInvitation = asyncHandler(async (req, res) => {
  const workspace = await Workspace.findById(req.params.id);
 if (!workspace) throw new ApiError(404, "Workspace not found.");

  
  const requester = workspace.members.find(
    (m) => m.user.toString() === req.user._id.toString()
  );
  if (!requester || !["owner", "admin"].includes(requester.role)) {
    throw new ApiError(403, "Only owners and admins can send invitations.");
  }

  const { email, role } = req.body;

  
  const existingInvite = await Invitation.findOne({
    email,
    workspace: workspace._id,
    status: "pending",
  });
  if (existingInvite) {
    throw new ApiError(409, "A pending invitation already exists for this email.");
  }

  
  const token = Invitation.generateToken();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  const invitation = await Invitation.create({
    email,
    workspace: workspace._id,
    role: role || "member",
    token,
    invitedBy: req.user._id,
    expiresAt,
  });

  await invitation.populate("invitedBy", "name email");

  
  const existingUser = await User.findOne({ email });
  if (existingUser) {
    await Notification.create({
      recipient: existingUser._id,
      actor: req.user._id,
      type: "invitation_received",
      message: `${req.user.name} invited you to join "${workspace.name}".`,
      link: `/invite/${token}`,
    });
  }

  res.status(201).json({
    message: "Invitation created.",
    invitation,
    
    inviteLink: `/invite/${token}`,
  });
});

export const getInvitations = asyncHandler(async (req, res) => {
  const workspace = await Workspace.findById(req.params.id);
  if (!workspace) throw new ApiError(404, "Workspace not found.");

  const requester = workspace.members.find(
    (m) => m.user.toString() === req.user._id.toString()
  );
  if (!requester || !["owner", "admin"].includes(requester.role)) {
    throw new ApiError(403, "Access denied.");
  }

  const invitations = await Invitation.find({
    workspace: workspace._id,
    status: "pending",
  })
    .populate("invitedBy", "name email avatar")
    .sort({ createdAt: -1 });

  res.json({ invitations });
});

export const cancelInvitation = asyncHandler(async (req, res) => {
  const workspace = await Workspace.findById(req.params.id);
  if (!workspace) throw new ApiError(404, "Workspace not found.");

  const requester = workspace.members.find(
    (m) => m.user.toString() === req.user._id.toString()
  );
  if (!requester || !["owner", "admin"].includes(requester.role)) {
    throw new ApiError(403, "Access denied.");
  }

  const invitation = await Invitation.findOne({
    _id: req.params.invId,
    workspace: workspace._id,
  });
  if (!invitation) throw new ApiError(404, "Invitation not found.");
  if (invitation.status !== "pending") {
    throw new ApiError(400, "This invitation is no longer pending.");
  }

  invitation.status = "cancelled";
  await invitation.save();

  res.json({ message: "Invitation cancelled." });
});

export const getInvitationByToken = asyncHandler(async (req, res) => {
  const invitation = await Invitation.findOne({
    token: req.params.token,
    status: "pending",
  }).populate("workspace", "name").populate("invitedBy", "name email");

  if (!invitation) throw new ApiError(404, "Invitation not found or already used.");

  if (invitation.expiresAt < new Date()) {
    invitation.status = "cancelled";
    await invitation.save();
    throw new ApiError(410, "This invitation has expired.");
  }

  res.json({ invitation });
});

export const acceptInvitation = asyncHandler(async (req, res) => {
  const invitation = await Invitation.findOne({
    token: req.params.token,
    status: "pending",
  }).populate("invitedBy", "name email");

  if (!invitation) throw new ApiError(404, "Invitation not found or already used.");

  if (invitation.expiresAt < new Date()) {
    invitation.status = "cancelled";
    await invitation.save();
    throw new ApiError(410, "This invitation has expired.");
  }

  
  if (req.user.email !== invitation.email) {
    throw new ApiError(403, "This invitation was sent to a different email address.");
  }

  const workspace = await Workspace.findById(invitation.workspace)
    .populate("members.user", "name email avatar")
    .populate("owner", "name email avatar");

  if (!workspace) throw new ApiError(404, "Workspace not found.");

  
  const alreadyMember = workspace.members.some(
    (m) => m.user._id.toString() === req.user._id.toString()
  );

  if (!alreadyMember) {
    workspace.members.push({ user: req.user._id, role: invitation.role });
    await workspace.save();
    await workspace.populate("members.user", "name email avatar");
  }

  invitation.status = "accepted";
  await invitation.save();

  
  if (invitation.invitedBy?._id) {
    await Notification.create({
      recipient: invitation.invitedBy._id,
      actor: req.user._id,
      type: "invitation_accepted",
      message: `${req.user.name} accepted your invitation to "${workspace.name}".`,
      link: "/app/members",
    });
  }

  res.json({
    message: "You have joined the workspace!",
    workspace,
  });
});
