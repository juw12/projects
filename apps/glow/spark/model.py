"""GlowSpark: a decoder-only transformer written from scratch.

Pre-norm blocks, RMSNorm, rotary position embeddings, tanh-GELU MLP, tied input/output embedding, no biases.
PyTorch supplies tensors and autograd only; there is no nn.Transformer and nothing is pretrained.
"""
import math

import torch
import torch.nn as nn
import torch.nn.functional as F


class RMSNorm(nn.Module):
    def __init__(self, dim):
        super().__init__()
        self.weight = nn.Parameter(torch.ones(dim))

    def forward(self, x):
        return x * torch.rsqrt(x.pow(2).mean(-1, keepdim=True) + 1e-6) * self.weight


def rotary_tables(head_dim, length):
    half = head_dim // 2
    frequencies = 1.0 / (10000 ** (torch.arange(half, dtype=torch.float32) / half))
    angles = torch.outer(torch.arange(length, dtype=torch.float32), frequencies)
    return angles.cos(), angles.sin()


def apply_rotary(x, cos, sin):
    half = x.shape[-1] // 2
    first, second = x[..., :half], x[..., half:]
    return torch.cat([first * cos - second * sin, first * sin + second * cos], dim=-1)


class Block(nn.Module):
    def __init__(self, dim, heads):
        super().__init__()
        self.heads = heads
        self.norm1 = RMSNorm(dim)
        self.qkv = nn.Linear(dim, 3 * dim, bias=False)
        self.proj = nn.Linear(dim, dim, bias=False)
        self.norm2 = RMSNorm(dim)
        self.up = nn.Linear(dim, 4 * dim, bias=False)
        self.down = nn.Linear(4 * dim, dim, bias=False)

    def forward(self, x, cos, sin):
        batch, length, dim = x.shape
        q, k, v = self.qkv(self.norm1(x)).view(batch, length, 3, self.heads, dim // self.heads).unbind(2)
        q = apply_rotary(q.transpose(1, 2), cos, sin)
        k = apply_rotary(k.transpose(1, 2), cos, sin)
        attended = F.scaled_dot_product_attention(q, k, v.transpose(1, 2), is_causal=True)
        x = x + self.proj(attended.transpose(1, 2).reshape(batch, length, dim))
        return x + self.down(F.gelu(self.up(self.norm2(x)), approximate="tanh"))


class Spark(nn.Module):
    def __init__(self, vocab, dim, layers, heads, context):
        super().__init__()
        self.config = {"vocab": vocab, "dim": dim, "layers": layers, "heads": heads, "context": context}
        self.embed = nn.Embedding(vocab, dim)
        self.blocks = nn.ModuleList(Block(dim, heads) for _ in range(layers))
        self.norm = RMSNorm(dim)
        cos, sin = rotary_tables(dim // heads, context)
        self.register_buffer("cos", cos, persistent=False)
        self.register_buffer("sin", sin, persistent=False)
        for name, parameter in self.named_parameters():
            if parameter.dim() == 2:
                scale = 0.02 / math.sqrt(2 * layers) if name.endswith(("proj.weight", "down.weight")) else 0.02
                nn.init.normal_(parameter, std=scale)

    def forward(self, tokens, targets=None):
        length = tokens.shape[1]
        x = self.embed(tokens)
        for block in self.blocks:
            x = block(x, self.cos[:length], self.sin[:length])
        logits = self.norm(x) @ self.embed.weight.T
        if targets is None:
            return logits
        return F.cross_entropy(logits.view(-1, logits.shape[-1]), targets.reshape(-1))

    def parameter_count(self):
        return sum(parameter.numel() for parameter in self.parameters())
