"""
PointNet++-lite — a compact PyTorch implementation of the set-abstraction /
feature-propagation architecture described in the tech stack (Revision
Notes Sec. 2 & 3: "PyTorch — ML framework. PointNet++ — trained LiDAR
perception model.").

Honesty note (important): this file defines the ARCHITECTURE. No trained
checkpoint ships with this repository because no labelled training run was
performed in this environment. Section 3 of the revision notes is explicit
that "PointNet++ tells us what is there; the optimization layer decides
how much resolution it deserves" — i.e. this network's job is strictly
classification (Terrain / Static / Dynamic), never REFINE/MAINTAIN/COARSEN.

If you have a trained `.pth` checkpoint (e.g. trained on SemanticPOSS or
your own data), drop it at `models/checkpoints/pointnet2.pth` and
`PerceptionModel` (perception.py) will automatically load and use it.
Until then, `PerceptionModel` falls back to a deterministic, label-driven
classifier so every endpoint still runs end-to-end.

Import of torch is optional: if it is not installed, `TORCH_AVAILABLE` is
False and perception.py silently uses the fallback path only.
"""
from __future__ import annotations

try:
    import torch
    import torch.nn as nn
    import torch.nn.functional as F
    TORCH_AVAILABLE = True
except Exception:  # pragma: no cover - exercised only when torch is absent
    TORCH_AVAILABLE = False


if TORCH_AVAILABLE:

    def square_distance(src, dst):
        return torch.sum((src[:, :, None, :] - dst[:, None, :, :]) ** 2, dim=-1)

    def farthest_point_sample(xyz, npoint):
        device = xyz.device
        B, N, _ = xyz.shape
        centroids = torch.zeros(B, npoint, dtype=torch.long, device=device)
        distance = torch.full((B, N), 1e10, device=device)
        farthest = torch.randint(0, N, (B,), dtype=torch.long, device=device)
        batch_indices = torch.arange(B, dtype=torch.long, device=device)
        for i in range(npoint):
            centroids[:, i] = farthest
            centroid = xyz[batch_indices, farthest, :].view(B, 1, 3)
            dist = torch.sum((xyz - centroid) ** 2, -1)
            mask = dist < distance
            distance[mask] = dist[mask]
            farthest = torch.max(distance, -1)[1]
        return centroids

    def index_points(points, idx):
        device = points.device
        B = points.shape[0]
        view_shape = list(idx.shape)
        view_shape[1:] = [1] * (len(view_shape) - 1)
        repeat_shape = list(idx.shape)
        repeat_shape[0] = 1
        batch_indices = torch.arange(B, dtype=torch.long, device=device) \
            .view(view_shape).repeat(repeat_shape)
        return points[batch_indices, idx, :]

    def query_ball_point(radius, nsample, xyz, new_xyz):
        device = xyz.device
        B, N, _ = xyz.shape
        _, S, _ = new_xyz.shape
        group_idx = torch.arange(N, dtype=torch.long, device=device).view(1, 1, N).repeat(B, S, 1)
        sqrdists = square_distance(new_xyz, xyz)
        group_idx[sqrdists > radius ** 2] = N
        group_idx = group_idx.sort(dim=-1)[0][:, :, :nsample]
        group_first = group_idx[:, :, 0].view(B, S, 1).repeat(1, 1, nsample)
        mask = group_idx == N
        group_idx[mask] = group_first[mask]
        return group_idx

    class SetAbstraction(nn.Module):
        """One PointNet++ set-abstraction layer: sample centroids, group
        local neighbourhoods, run a shared MLP, max-pool -> local feature."""

        def __init__(self, npoint, radius, nsample, in_channel, mlp):
            super().__init__()
            self.npoint, self.radius, self.nsample = npoint, radius, nsample
            layers = []
            last = in_channel + 3
            for out_c in mlp:
                layers += [nn.Conv2d(last, out_c, 1), nn.BatchNorm2d(out_c), nn.ReLU()]
                last = out_c
            self.mlp = nn.Sequential(*layers)

        def forward(self, xyz, points):
            B, N, _ = xyz.shape
            fps_idx = farthest_point_sample(xyz, self.npoint)
            new_xyz = index_points(xyz, fps_idx)
            idx = query_ball_point(self.radius, self.nsample, xyz, new_xyz)
            grouped_xyz = index_points(xyz, idx) - new_xyz.unsqueeze(2)
            if points is not None:
                grouped_points = torch.cat([grouped_xyz, index_points(points, idx)], dim=-1)
            else:
                grouped_points = grouped_xyz
            grouped_points = grouped_points.permute(0, 3, 2, 1)  # B, C, nsample, npoint
            new_points = self.mlp(grouped_points)
            new_points = torch.max(new_points, 2)[0].permute(0, 2, 1)  # B, npoint, C
            return new_xyz, new_points

    class PointNet2Lite(nn.Module):
        """
        Minimal 2-stage PointNet++ classifier producing per-point logits
        over 3 semantic buckets: Terrain / Static / Dynamic
        (Revision Notes Sec. 3).
        """

        NUM_CLASSES = 3  # 0=terrain, 1=static, 2=dynamic

        def __init__(self):
            super().__init__()
            self.sa1 = SetAbstraction(npoint=512, radius=0.8, nsample=32, in_channel=1, mlp=[32, 32, 64])
            self.sa2 = SetAbstraction(npoint=128, radius=2.0, nsample=32, in_channel=64, mlp=[64, 64, 128])
            self.head = nn.Sequential(
                nn.Linear(128, 64), nn.ReLU(),
                nn.Linear(64, self.NUM_CLASSES),
            )

        def forward(self, xyz, intensity):
            """xyz: (B,N,3), intensity: (B,N,1) -> per-region logits (B, npoint2, 3)."""
            l1_xyz, l1_points = self.sa1(xyz, intensity)
            l2_xyz, l2_points = self.sa2(l1_xyz, l1_points)
            logits = self.head(l2_points)
            return l2_xyz, logits

    def load_checkpoint(path: str) -> "PointNet2Lite":
        model = PointNet2Lite()
        state = torch.load(path, map_location="cpu")
        model.load_state_dict(state)
        model.eval()
        return model
