/**
 * Rendered component test: SessionCreatePage conflict modal.
 *
 * Verifies that the session-create form, when it receives a conflict
 * result from the scheduling service, renders the modal with conflict
 * details and scored alternative rooms.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import '@testing-library/jest-dom';

// ============================================================
// Mock dependencies before importing the component
// ============================================================

const mockRooms = [
  {
    room_id: 'room-1',
    name: 'Room Alpha',
    building_code: 'B1',
    floor_code: 'F1',
    capacity: 30,
    equipment: ['projector'],
    _version: 1,
  },
  {
    room_id: 'room-2',
    name: 'Room Beta',
    building_code: 'B2',
    floor_code: 'F2',
    capacity: 25,
    equipment: [],
    _version: 1,
  },
];

const conflictResult = {
  conflicts: [
    {
      type: 'time_overlap' as const,
      description: 'Booking b-99 overlaps with the requested time range',
      conflicting_record_id: 'b-99',
    },
  ],
  alternatives: [
    {
      room: mockRooms[1],
      total_score: 0.85,
      scores: { capacity_fit: 0.9, equipment_match: 0.8, availability: 1.0, distance: 0.7 },
    },
  ],
};

vi.mock('../src/lib/services/idbAccessLayer', () => ({
  idbAccessLayer: {
    getAll: vi.fn(async () => mockRooms),
    get: vi.fn(),
    put: vi.fn(),
  },
}));

vi.mock('../src/lib/services/roomSchedulingService', () => ({
  roomSchedulingService: {
    createSessionBooking: vi.fn(async () => conflictResult),
  },
}));

vi.mock('../src/lib/services/rbacService', () => ({
  rbacService: {
    checkPermission: vi.fn(),
    getCurrentSession: vi.fn(() => ({
      user_id: 'inst-1',
      role: 'INSTRUCTOR',
      org_unit: 'TestUnit',
      token: 'tok',
      expires_at: Date.now() + 86400000,
    })),
  },
}));

vi.mock('../src/lib/utils/router', () => ({
  navigate: vi.fn(),
}));

// ============================================================
// Tests
// ============================================================

describe('SessionCreatePage — Conflict Modal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the form and shows conflict modal after submit', async () => {
    const { default: SessionCreatePage } = await import(
      '../src/routes/registration/SessionCreatePage.svelte'
    );

    render(SessionCreatePage);

    // Wait for rooms to load
    await waitFor(() => {
      expect(screen.getByLabelText('Session Title')).toBeInTheDocument();
    });

    // Fill in the form
    const titleInput = screen.getByLabelText('Session Title');
    const dateInput = screen.getByLabelText('Date');
    const startInput = screen.getByLabelText('Start Time');
    const endInput = screen.getByLabelText('End Time');
    const roomSelect = screen.getByLabelText('Room');

    await fireEvent.input(titleInput, { target: { value: 'Test Session' } });
    await fireEvent.input(dateInput, { target: { value: '2026-05-01' } });
    await fireEvent.input(startInput, { target: { value: '09:00' } });
    await fireEvent.input(endInput, { target: { value: '11:00' } });
    await fireEvent.change(roomSelect, { target: { value: 'room-1' } });

    // Submit the form
    const submitBtn = screen.getByRole('button', { name: /Create Session/i });
    await fireEvent.click(submitBtn);

    // Wait for the conflict modal to appear
    await waitFor(() => {
      expect(screen.getByText('Scheduling Conflict')).toBeInTheDocument();
    });

    // Verify conflict details are shown
    expect(screen.getByText(/time overlap/i)).toBeInTheDocument();
    expect(screen.getByText(/overlaps with the requested time range/i)).toBeInTheDocument();

    // Verify alternative room is shown with scoring
    expect(screen.getByText('Alternative Rooms')).toBeInTheDocument();
    expect(screen.getByText('Room Beta')).toBeInTheDocument();
    expect(screen.getByText(/Score: 0\.85/)).toBeInTheDocument();

    // Verify scoring breakdown is present
    expect(screen.getByText(/Capacity: 0\.90/)).toBeInTheDocument();
    expect(screen.getByText(/Availability: 1\.00/)).toBeInTheDocument();

    // Verify "Book This Room" button is present
    expect(screen.getByRole('button', { name: /Book This Room/i })).toBeInTheDocument();
  });

  it('closes the modal when Cancel is clicked', async () => {
    const { default: SessionCreatePage } = await import(
      '../src/routes/registration/SessionCreatePage.svelte'
    );

    render(SessionCreatePage);

    await waitFor(() => {
      expect(screen.getByLabelText('Session Title')).toBeInTheDocument();
    });

    // Fill and submit
    await fireEvent.input(screen.getByLabelText('Session Title'), { target: { value: 'X' } });
    await fireEvent.input(screen.getByLabelText('Date'), { target: { value: '2026-05-01' } });
    await fireEvent.input(screen.getByLabelText('Start Time'), { target: { value: '09:00' } });
    await fireEvent.input(screen.getByLabelText('End Time'), { target: { value: '11:00' } });
    await fireEvent.change(screen.getByLabelText('Room'), { target: { value: 'room-1' } });
    await fireEvent.click(screen.getByRole('button', { name: /Create Session/i }));

    await waitFor(() => {
      expect(screen.getByText('Scheduling Conflict')).toBeInTheDocument();
    });

    // Click the modal's close button (×)
    const closeBtn = screen.getByRole('button', { name: /Close/i });
    await fireEvent.click(closeBtn);

    // Modal should disappear
    await waitFor(() => {
      expect(screen.queryByText('Scheduling Conflict')).not.toBeInTheDocument();
    });
  });
});
