# funcs/audio_funcs.py
import math
from typing import Optional

import numpy as np
import torch
import torch.nn.functional as F
import librosa


class Audio2Mel(torch.nn.Module):
    """
    Compute log-mel spectrograms.

    Example:
        fft = Audio2Mel(
            n_fft=512,
            hop_length=int(16000/120),
            win_length=int(16000/60),
            sampling_rate=16000,
            n_mel_channels=80,
            mel_fmin=90,
            mel_fmax=7600.0,
        ).to(device)

        # audio: Tensor [B, 1, T], normalized to [-1, 1]
        mel = fft(audio)  # -> [B, n_mels, frames]
    """

    def __init__(
        self,
        n_fft: int = 512,
        hop_length: int = 256,
        win_length: int = 1024,
        sampling_rate: int = 16000,
        n_mel_channels: int = 80,
        mel_fmin: float = 90.0,
        mel_fmax: float = 7600.0,
    ):
        super().__init__()

        # FFT / Mel parameters
        self.n_fft = n_fft
        self.hop_length = hop_length
        self.win_length = win_length
        self.sampling_rate = sampling_rate
        self.n_mel_channels = n_mel_channels
        self.mel_fmin = mel_fmin
        self.mel_fmax = mel_fmax
        self.min_mel = math.log(1e-5)

        # Create Hann window and mel filterbank
        window = torch.hann_window(win_length).float()

        # Safe call for both older and newer librosa versions
        try:
            mel_basis_np = librosa.filters.mel(
                sr=sampling_rate,
                n_fft=n_fft,
                n_mels=n_mel_channels,
                fmin=mel_fmin,
                fmax=mel_fmax,
                htk=False,
                norm="slaney",
                dtype=np.float32,  # Newer librosa versions
            )
        except TypeError:
            # Older librosa without dtype parameter
            mel_basis_np = librosa.filters.mel(
                sr=sampling_rate,
                n_fft=n_fft,
                n_mels=n_mel_channels,
                fmin=mel_fmin,
                fmax=mel_fmax,
                htk=False,
                norm="slaney",
            ).astype(np.float32)

        mel_basis = torch.from_numpy(mel_basis_np)

        # Register buffers so they move automatically to GPU if model.cuda()
        self.register_buffer("mel_basis", mel_basis)
        self.register_buffer("window", window)

    def forward(self, audio: torch.Tensor, normalize: bool = True) -> torch.Tensor:
        """
        Compute mel spectrogram.

        Args:
            audio: Tensor [B, 1, T]
            normalize: if True, scale log-mels to [0,1]
        Returns:
            log-mel: Tensor [B, n_mels, frames]
        """
        p = (self.n_fft - self.hop_length) // 2
        audio = F.pad(audio, (p, p), "reflect").squeeze(1)

        stft = torch.stft(
            audio,
            n_fft=self.n_fft,
            hop_length=self.hop_length,
            win_length=self.win_length,
            window=self.window,
            center=False,
            return_complex=False,
        )  # -> [B, freq, frames, 2]

        real, imag = stft.unbind(-1)
        magnitude = torch.sqrt(real ** 2 + imag ** 2)  # [B, freq, frames]

        mel_output = torch.matmul(self.mel_basis, magnitude)  # [B, n_mels, frames]
        log_mel = torch.log(torch.clamp(mel_output, min=1e-5))

        if normalize:
            log_mel = (log_mel - self.min_mel) / -self.min_mel

        return log_mel

    def mel_to_audio(self, mel: torch.Tensor) -> np.ndarray:
        """
        Invert mel spectrogram to waveform using Griffin-Lim.
        """
        if mel.dim() == 3:
            mel = mel[0]

        mel = torch.exp(mel * (-self.min_mel) + self.min_mel) ** 2
        mel_np = mel.detach().cpu().numpy()

        audio = librosa.feature.inverse.mel_to_audio(
            mel_np,
            sr=self.sampling_rate,
            n_fft=self.n_fft,
            hop_length=self.hop_length,
            win_length=self.win_length,
            window="hann",
            center=False,
            pad_mode="reflect",
            power=2.0,
            n_iter=32,
            fmin=self.mel_fmin,
            fmax=self.mel_fmax,
        ).astype(np.float32)

        return audio

    def get_energy(self, audio: torch.Tensor, normalize: bool = True) -> torch.Tensor:
        """
        Compute per-frame energy of the signal.
        """
        p = (self.n_fft - self.hop_length) // 2
        audio_new = F.pad(audio, (p, p), "reflect").squeeze(1)
        audio_fold = audio_new.unfold(1, self.win_length, self.hop_length)
        audio_energy = torch.sqrt(torch.mean(audio_fold ** 2, dim=-1))
        audio_energy = torch.log(torch.clamp(audio_energy, min=1e-5))
        if normalize:
            audio_energy = (audio_energy - self.min_mel) / -self.min_mel
        return audio_energy

    def get_energy_mel(self, mels: torch.Tensor, normalize: bool = True) -> torch.Tensor:
        """
        Compute energy directly from mel spectrogram.
        """
        m = mels.exp().mean(dim=1)
        audio_energy = torch.log(m)
        return audio_energy


# Utility functions for NumPy-based preprocessing or debugging
def numpy_audio_to_mel(
    audio_np: np.ndarray,
    device: Optional[torch.device] = None,
    n_fft: int = 512,
    hop_length: int = 256,
    win_length: int = 1024,
    sampling_rate: int = 16000,
    n_mel_channels: int = 80,
    mel_fmin: float = 90.0,
    mel_fmax: float = 7600.0,
    normalize: bool = True,
) -> np.ndarray:
    """
    Compute mel-spectrogram directly from NumPy audio.
    """
    if audio_np.ndim != 1:
        raise ValueError("audio_np must be a 1D mono waveform")

    device = device or torch.device("cpu")

    model = Audio2Mel(
        n_fft=n_fft,
        hop_length=hop_length,
        win_length=win_length,
        sampling_rate=sampling_rate,
        n_mel_channels=n_mel_channels,
        mel_fmin=mel_fmin,
        mel_fmax=mel_fmax,
    ).to(device)

    with torch.no_grad():
        x = torch.from_numpy(audio_np.astype(np.float32))[None, None, :].to(device)
        mel = model(x, normalize=normalize)[0].cpu().numpy()

    return mel
