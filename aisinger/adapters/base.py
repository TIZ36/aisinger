from __future__ import annotations

from abc import ABC, abstractmethod
from pathlib import Path

from ..voicelib.schema import Tier, Voice


class VoiceCloneAdapter(ABC):
    tier: Tier

    @abstractmethod
    def create_voice(self, name: str, samples: list[Path], **kwargs) -> Voice:
        """从样本创建/训练一个音色，写入 voicelib。"""

    @abstractmethod
    def synthesize(self, voice: Voice, target: Path | str, **kwargs) -> Path:
        """用该音色合成新音频。

        - 简易档：target 为 str（文本）
        - 中/高档：target 为 Path（目标歌曲音频）
        返回输出 wav 路径。
        """
