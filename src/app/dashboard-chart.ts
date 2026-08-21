import { Component, ElementRef, Input, OnChanges, ViewChild, SimpleChanges } from '@angular/core';
import * as d3 from 'd3';

@Component({
  selector: 'app-dashboard-chart',
  template: '<div #chartContainer class="w-full h-64"></div>',
  standalone: true
})
export class DashboardChart implements OnChanges {
  @ViewChild('chartContainer', { static: true }) chartContainer!: ElementRef;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  @Input() data: any[] = [];
  @Input() type: 'bar' | 'line' = 'bar';

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['data'] && this.data.length > 0) {
      this.renderChart();
    }
  }

  renderChart() {
    const container = this.chartContainer.nativeElement;
    d3.select(container).selectAll('*').remove();
    
    const margin = { top: 20, right: 30, bottom: 40, left: 40 };
    const width = container.clientWidth - margin.left - margin.right;
    const height = 250 - margin.top - margin.bottom;

    const svg = d3.select(container)
      .append('svg')
      .attr('width', width + margin.left + margin.right)
      .attr('height', height + margin.top + margin.bottom)
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    const x = d3.scaleBand()
      .domain(this.data.map(d => d.month || d.name))
      .range([0, width])
      .padding(0.1);

    const y = d3.scaleLinear()
      .domain([0, d3.max(this.data, (d: any) => d.revenue || d.balance || 0) || 100])
      .range([height, 0]);

    svg.append('g')
      .attr('transform', `translate(0,${height})`)
      .call(d3.axisBottom(x));

    svg.append('g')
      .call(d3.axisLeft(y));

    svg.selectAll('.bar')
      .data(this.data)
      .enter()
      .append('rect')
      .attr('class', 'bar')
      .attr('x', (d: any) => x(d.month || d.name)!)
      .attr('width', x.bandwidth())
      .attr('y', (d: any) => y(d.revenue || d.balance || 0))
      .attr('height', (d: any) => height - y(d.revenue || d.balance || 0))
      .attr('fill', '#3b82f6');
  }
}
